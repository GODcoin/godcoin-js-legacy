import { Asset } from 'godcoin-neon';
import {
  BondTx,
  PublicKey,
  RewardTx,
  SignedBlock,
  TransferTx
} from 'godcoin-neon';
import * as Long from 'long';
import {
  addBalAgnostic,
  subBalAgnostic
} from '../asset';
import { ChainStore } from '../blockchain';
import { Lock } from '../lock';
import { AssetMap, BatchIndex } from './batch';
import { Indexer } from './index';

export type CacheMissCallback = (key: PublicKey) => Promise<[Asset, Asset]>;

export class BlockIndexer {

  private readonly lock = new Lock();
  private readonly batch: BatchIndex;

  private height: number = 0;
  private map: AssetMap = {};
  private supply: [Asset, Asset] = [Asset.EMPTY_GOLD, Asset.EMPTY_SILVER];

  constructor(readonly indexer: Indexer,
              readonly store: ChainStore,
              readonly cmcb: CacheMissCallback) {
    this.batch = new BatchIndex(indexer);
  }

  async index(block: SignedBlock, bytePos?: number) {
    await this.lock.lock();
    try {
      await this.indexTransactions(block);
      if (block.height > this.height) this.height = block.height;

      {
        let posLong: Long;
        if (bytePos === undefined) posLong = await this.store.write(block);
        else posLong = Long.fromNumber(bytePos, true);
        await this.batch.setBlockPos(block.height, posLong);
      }

      if (block.height % 1000 === 0 && process.env.NODE_ENV !== 'TEST') {
        console.log('=> Indexed block:', block.height.toString());
      }
    } finally {
      this.lock.unlock();
    }
  }

  async flush() {
    await this.lock.lock();
    try {
      await this.batch.setBalances(this.map);
      await this.batch.flush();
      await this.indexer.setChainHeight(this.height);

      const supply = await this.indexer.getTokenSupply();
      supply[0] = supply[0].add(this.supply[0]);
      supply[1] = supply[1].add(this.supply[1]);
      await this.indexer.setTokenSupply(supply);

      this.supply = [Asset.EMPTY_GOLD, Asset.EMPTY_SILVER];
      this.map = {};
    } finally {
      this.lock.unlock();
    }
  }

  private async indexTransactions(block: SignedBlock) {
    for (const tx of block.transactions) {
      if (tx instanceof TransferTx) {
        const fromBal = await this.getBal(tx.from);
        const toBal = await this.getBal(tx.to);
        subBalAgnostic(fromBal, tx.amount);
        subBalAgnostic(fromBal, tx.fee);
        addBalAgnostic(toBal, tx.amount);
      } else if (tx instanceof BondTx) {
        const bal = await this.getBal(tx.staker);
        subBalAgnostic(bal, tx.fee);
        subBalAgnostic(bal, tx.bond_fee);
        subBalAgnostic(bal, tx.stake_amt);
        subBalAgnostic(this.supply, tx.bond_fee);

        // Bonds don't happen often so it's safe to immediately flush without a
        // loss of performance
        await this.indexer.setBond(tx);
      } else if (tx instanceof RewardTx) {
        const toBal = await this.getBal(tx.to);
        for (const reward of tx.rewards) {
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
}
