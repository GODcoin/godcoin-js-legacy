import { TransferTx, RewardTx, BondTx } from '../transactions';
import { ChainStore, SignedBlock } from '../blockchain';
import { Indexer, IndexProp } from '../indexer';
import { AssetSymbol } from '../asset';
import { PublicKey } from '../crypto';
import * as Codec from 'level-codec';
import { Asset } from '../asset';
import { Lock } from '../lock';
import * as Long from 'long';

export type CacheMissCallback = (key: PublicKey) => Promise<[Asset,Asset]>;
export type AssetMap = { [acc: string]: [Asset,Asset] };

const jsonCodec = new Codec({
  keyEncoding: 'binary',
  valueEncoding: 'json'
});

export class BatchIndex {

  private readonly lock = new Lock();
  private head: SignedBlock|undefined;

  private ops: any[] = [];
  private map: AssetMap = {};

  constructor(readonly indexer: Indexer,
              readonly store: ChainStore,
              readonly cmcb: CacheMissCallback) {
  }

  async index(block: SignedBlock, bytePos?: number) {
    await this.lock.lock();
    try {
      if (this.head) block.validate(this.head);
      this.head = block;

      await this.indexTransactions(block);
      if (bytePos !== undefined) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeInt32BE(block.height.high, 0, true);
        buf.writeInt32BE(block.height.low, 4, true);

        const val = Long.fromNumber(bytePos, true);
        const pos = Buffer.allocUnsafe(8);
        pos.writeInt32BE(val.high, 0, true);
        pos.writeInt32BE(val.low, 4, true);

        this.ops.push({
          type: 'put',
          key: Buffer.concat([IndexProp.NAMESPACE_BLOCK, buf]),
          value: pos
        });
        if (this.ops.length >= 1000) await this.flushOps();
      } else {
        await this.store.write(block);
      }
      if (block.height.mod(1000).eq(0) && process.env.NODE_ENV !== 'TEST') {
        console.log('=> Indexed block:', block.height.toString());
      }
    } finally {
      this.lock.unlock();
    }
  }

  private async indexTransactions(block: SignedBlock) {
    for (const tx of block.transactions) {
      if (tx instanceof TransferTx) {
        const fromBal = await this.getBal(tx.data.from);
        const toBal = await this.getBal(tx.data.to);
        if (tx.data.amount.symbol === AssetSymbol.GOLD) {
          fromBal[0] = fromBal[0].sub(tx.data.amount).sub(tx.data.fee);
          toBal[0] = toBal[0].add(tx.data.amount);
        } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
          fromBal[1] = fromBal[1].sub(tx.data.amount).sub(tx.data.fee);
          toBal[1] = toBal[1].add(tx.data.amount);
        } else {
          throw new Error('unhandled symbol: ' + tx.data.amount.symbol);
        }
      } else if (tx instanceof RewardTx) {
        const toBal = await this.getBal(tx.data.to);
        for (const reward of tx.data.rewards) {
          if (reward.symbol === AssetSymbol.GOLD) {
            toBal[0] = toBal[0].add(reward);
          } else if (reward.symbol === AssetSymbol.SILVER) {
            toBal[1] = toBal[1].add(reward);
          } else {
            throw new Error('unhandled symbol: ' + reward.symbol);
          }
        }
      } else if (tx instanceof BondTx) {
        const stakerBal = await this.getBal(tx.data.staker);
        if (tx.data.bond_fee.symbol === AssetSymbol.GOLD) {
          stakerBal[0] = stakerBal[0].sub(tx.data.bond_fee).sub(tx.data.fee);
        } else if (tx.data.bond_fee.symbol === AssetSymbol.SILVER) {
          stakerBal[1] = stakerBal[1].sub(tx.data.bond_fee).sub(tx.data.fee);
        } else {
          throw new Error('unhandled symbol: ' + tx.data.bond_fee.symbol);
        }
      }
    }
  }

  private async getBal(key: PublicKey): Promise<[Asset, Asset]> {
    const hex = key.buffer.toString('hex');
    let cache = this.map[hex];
    if (!cache) cache = this.map[hex] = await this.cmcb(key);
    return cache;
  }

  async flush() {
    await this.lock.lock();
    try {
      await this.flushBalances();
      await this.flushOps();
    } finally {
      this.lock.unlock();
    }
  }

  private async flushBalances(): Promise<void> {
    const batch = this.indexer.db.db.batch();
    batch.codec = jsonCodec; // Workaround for encoding-down
    for (const [hex, assets] of Object.entries(this.map)) {
      const key = [IndexProp.NAMESPACE_BAL, Buffer.from(hex, 'hex')];
      batch.put(Buffer.concat(key), [
        assets[0].toString(),
        assets[1].toString()
      ]);
    }
    return new Promise<void>((res, rej) => {
      batch.write(err => {
        if (err) return rej(err);
        this.map = {};
        res();
      });
    });
  }

  private async flushOps() {
    if (this.ops.length) {
      await new Promise<void>((res, rej) => {
        const batch = this.indexer.db.db.batch(this.ops, err => {
          if (err) return rej(err);
          res();
        });
      });
      this.ops.length = 0;
    }
  }
}
