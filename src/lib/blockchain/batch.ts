import { Indexer, IndexProp, BalanceMap, CacheMissCallback } from '../indexer';
import { TransferTx, RewardTx } from '../transactions';
import { ChainStore } from './chain_store';
import { AssetSymbol } from '../asset';
import { SignedBlock } from './block';
import * as Long from 'long';
import { Lock } from '../lock';

export class BatchIndex {

  private readonly lock = new Lock();
  private head: SignedBlock|undefined;
  private balances: BalanceMap;
  private ops: any[] = [];

  constructor(readonly indexer: Indexer,
              readonly store: ChainStore,
              readonly cmcb: CacheMissCallback) {
    this.balances = new BalanceMap(indexer, cmcb);
  }

  async index(block: SignedBlock, bytePos?: number) {
    await this.lock.lock();
    try {
      if (this.head) block.validate(this.head);
      this.head = block;

      await this.balances.update(block);
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
      if (block.height.mod(1000).eq(0)) {
        console.log('=> Indexed block:', block.height.toString());
      }
    } finally {
      this.lock.unlock();
    }
  }

  async flush() {
    await this.lock.lock();
    try {
      await this.flushOps();
      await this.balances.write();
    } finally {
      this.lock.unlock();
    }
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
