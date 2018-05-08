import { TransferTx, RewardTx } from '../transactions';
import { Asset, AssetSymbol } from '../asset';
import { Indexer, IndexProp } from './index';
import { SignedBlock } from '../blockchain';
import { PublicKey } from '../crypto';
import * as Codec from 'level-codec';

const jsonCodec = new Codec({
  keyEncoding: 'binary',
  valueEncoding: 'json'
});

export type CacheMissCallback = (key: PublicKey) => Promise<[Asset,Asset]>;
export type AssetMap = { [acc: string]: [Asset,Asset] };

export class BalanceMap {

  private map: AssetMap = {};

  private _count = 0;
  get count() { return this._count; }

  constructor(readonly indexer: Indexer,
              readonly cacheMiss: CacheMissCallback) {
  }

  async getBal(key: PublicKey): Promise<[Asset, Asset]> {
    const hex = key.buffer.toString('hex');
    let cache = this.map[hex];
    if (!cache) {
      cache = this.map[hex] = await this.cacheMiss(key);
      ++this._count;
    }
    return cache;
  }

  async update(block: SignedBlock): Promise<void> {
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
      }
    }
  }

  async write(): Promise<void> {
    if (this.count <= 0) return;
    const batch = this.indexer.db.db.batch();
    batch.codec = jsonCodec; // Workaround for encoding-down
    for (const [hex, assets] of Object.entries(this.flush())) {
      const key = [IndexProp.NAMESPACE_BAL, Buffer.from(hex, 'hex')];
      batch.put(Buffer.concat(key), [
        assets[0].toString(),
        assets[1].toString()
      ]);
    }
    return new Promise<void>((res, rej) => {
      batch.write(err => {
        if (err) return rej(err);
        res();
      });
    });
  }

  private flush(): AssetMap {
    const map = this.map;
    this.map = {};
    this._count = 0;
    return map;
  }
}
