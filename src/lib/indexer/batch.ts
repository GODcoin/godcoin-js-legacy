import * as Codec from 'level-codec';
import * as Long from 'long';
import { Asset, EMPTY_GOLD, EMPTY_SILVER } from '../asset';
import { ChainStore, SignedBlock } from '../blockchain';
import { PublicKey } from '../crypto';
import { Lock } from '../lock';
import {
  addBalAgnostic,
  BondTx,
  RewardTx,
  subBalAgnostic,
  TransferTx
} from '../transactions';
import { Indexer, IndexProp } from './index';

export type CacheMissCallback = (key: PublicKey) => Promise<[Asset, Asset]>;
export interface AssetMap {
  [acc: string]: [Asset, Asset];
}

const jsonCodec = new Codec({
  keyEncoding: 'binary',
  valueEncoding: 'json'
});

export class BatchIndex {

  private readonly lock = new Lock();

  private ops: any[] = [];
  private map: AssetMap = {};
  private height: Long = Long.fromNumber(0, true);
  private supply: [Asset, Asset] = [EMPTY_GOLD, EMPTY_SILVER];

  constructor(readonly indexer: Indexer,
              readonly store: ChainStore,
              readonly cmcb: CacheMissCallback) {
  }

  async index(block: SignedBlock, bytePos?: number) {
    await this.lock.lock();
    try {
      await this.indexTransactions(block);
      if (block.height.gt(this.height)) this.height = block.height;

      {
        let posLong: Long;
        if (bytePos === undefined) {
          posLong = await this.store.write(block);
        } else {
          posLong = Long.fromNumber(bytePos, true);
        }

        const pos = Buffer.allocUnsafe(8);
        pos.writeInt32BE(posLong.high, 0, true);
        pos.writeInt32BE(posLong.low, 4, true);

        const blkHeightBuf = Buffer.allocUnsafe(8);
        blkHeightBuf.writeInt32BE(block.height.high, 0, true);
        blkHeightBuf.writeInt32BE(block.height.low, 4, true);

        this.ops.push({
          type: 'put',
          key: Buffer.concat([IndexProp.NAMESPACE_BLOCK, blkHeightBuf]),
          value: pos
        });
      }

      if (this.ops.length >= 1000) await this.flushOps();
      if (block.height.mod(1000).eq(0) && process.env.NODE_ENV !== 'TEST') {
        console.log('=> Indexed block:', block.height.toString());
      }
    } finally {
      this.lock.unlock();
    }
  }

  async flush() {
    await this.lock.lock();
    try {
      await this.flushBalances();
      await this.flushOps();
      await this.indexer.setChainHeight(this.height);

      const supply = await this.indexer.getTokenSupply();
      supply[0] = supply[0].add(this.supply[0]);
      supply[1] = supply[1].add(this.supply[1]);
      await this.indexer.setTokenSupply(supply);
      this.supply = [EMPTY_GOLD, EMPTY_SILVER];
    } finally {
      this.lock.unlock();
    }
  }

  private async indexTransactions(block: SignedBlock) {
    for (const tx of block.transactions) {
      if (tx instanceof TransferTx) {
        const fromBal = await this.getBal(tx.data.from);
        const toBal = await this.getBal(tx.data.to);
        subBalAgnostic(fromBal, tx.data.amount);
        subBalAgnostic(fromBal, tx.data.fee);
        addBalAgnostic(toBal, tx.data.amount);
      } else if (tx instanceof BondTx) {
        const bal = await this.getBal(tx.data.staker);
        subBalAgnostic(bal, tx.data.fee);
        subBalAgnostic(bal, tx.data.bond_fee);
        subBalAgnostic(bal, tx.data.stake_amt);
        subBalAgnostic(this.supply, tx.data.bond_fee);

        // Bonds don't happen often so it's safe to immediately flush without a
        // loss of performance
        await this.indexer.setBond(tx.data);
      } else if (tx instanceof RewardTx) {
        const toBal = await this.getBal(tx.data.to);
        for (const reward of tx.data.rewards) {
          addBalAgnostic(toBal, reward);
          addBalAgnostic(this.supply, reward);
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

  private async flushOps(): Promise<void> {
    if (this.ops.length) {
      await new Promise<void>((res, rej) => {
        this.indexer.db.db.batch(this.ops, err => {
          if (err) return rej(err);
          res();
        });
      });
      this.ops.length = 0;
    }
  }
}
