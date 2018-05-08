import { Indexer, IndexProp, BalanceMap, CacheMissCallback } from '../indexer';
import { TransferTx, RewardTx } from '../transactions';
import { ChainStore } from './chain_store';
import { AssetSymbol } from '../asset';
import { SignedBlock } from './block';
import * as Long from 'long';

export class BatchIndex {

  private head: SignedBlock|undefined;
  private balances: BalanceMap;
  private ops: any[] = [];

  constructor(readonly indexer: Indexer,
              readonly store: ChainStore,
              readonly cmcb: CacheMissCallback) {
    this.balances = new BalanceMap(indexer, cmcb);
  }

  async index(block: SignedBlock, bytePos?: number) {
    if (this.head) block.validate(this.head);
    this.head = block;
    await this.balances.update(this.head);
    if (bytePos !== undefined) {
      const buf = Buffer.allocUnsafe(8);
      buf.writeInt32BE(this.head.height.high, 0, true);
      buf.writeInt32BE(this.head.height.low, 4, true);

      const val = Long.fromNumber(bytePos, true);
      const pos = Buffer.allocUnsafe(8);
      pos.writeInt32BE(val.high, 0, true);
      pos.writeInt32BE(val.low, 4, true);

      this.ops.push({
        type: 'put',
        key: Buffer.concat([IndexProp.NAMESPACE_BLOCK, buf]),
        value: pos
      });
      if (this.ops.length >= 1000) {
        await new Promise<void>((res, rej) => {
          const batch = this.indexer.db.db.batch(this.ops, err => {
            if (err) return rej(err);
            res();
          });
        });
        this.ops.length = 0;
      }
    } else {
      await this.store.write(block);
    }
    if (this.head.height.mod(1000).eq(0)) {
      console.log('=> Indexed block:', this.head.height.toString());
    }
  }

  async flush() {
    if (this.ops.length) {
      await new Promise<void>((res, rej) => {
        const batch = this.indexer.db.db.batch(this.ops, err => {
          if (err) return rej(err);
          res();
        });
      });
      this.ops.length = 0;
    }
    await this.balances.write();
  }
}
