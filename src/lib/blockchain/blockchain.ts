import { Tx, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Asset, AssetSymbol, Balance } from '../asset';
import { Indexer, IndexProp } from '../indexer';
import { Block, SignedBlock } from './block';
import { ChainStore } from './chain_store';
import { BigInteger } from 'big-integer';
import * as bigInt from 'big-integer';
import * as assert from 'assert';
import * as Long from 'long';
export * from './block';

export class Blockchain {

  private genesisBlock!: SignedBlock;

  readonly store: ChainStore;
  readonly indexer: Indexer;

  constructor(store: ChainStore, indexer: Indexer) {
    this.store = store;
    this.indexer = indexer;
  }

  async start(): Promise<void> {
    await this.store.init();
    this.genesisBlock = (await this.store.read(0))!;
  }

  async stop(): Promise<void> {
    await this.indexer.close();
    await this.store.close();
  }

  async addBlock(block: SignedBlock): Promise<void> {
    if (!this.store.blockHead && block.height.eq(0)) {
      // Write the genesis block directly
      this.genesisBlock = block;
      return this.store.write(block);
    }
    assert(this.store.blockHead.height.add(1).eq(block.height), 'unexpected height');
    assert(this.isBondValid(block.signing_key), 'invalid bond');
    block.validate(this.getLatestBlock());
    await this.store.write(block);
  }

  getLatestBlock(): SignedBlock {
    return this.store.blockHead;
  }

  async getBlock(num: number): Promise<SignedBlock|undefined> {
    return this.store.read(num);
  }

  async isBondValid(key: string|PublicKey): Promise<boolean> {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    return this.genesisBlock.signing_key.equals(key);
  }

  async getBalance(key: string|PublicKey): Promise<Balance> {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    let gold = new Asset(bigInt(0), 0, AssetSymbol.GOLD);
    let silver = new Asset(bigInt(0), 0, AssetSymbol.SILVER);
    let i = Long.fromNumber(0, true);
    for (; i.lt(this.store.blockHead.height); i = i.add(1)) {
      const block = await this.store.read(i);
      const bal = Blockchain.getBlockBalance(key, block!.transactions);
      gold = gold.add(bal.gold);
      silver = silver.add(bal.silver);
    }
    return {
      gold,
      silver
    };
  }

  private static getBlockBalance(key: PublicKey,
                                  txs: Tx[]): Balance {
    let gold = new Asset(bigInt(0), 0, AssetSymbol.GOLD);
    let silver = new Asset(bigInt(0), 0, AssetSymbol.SILVER);
    for (const tx of txs) {
      if (tx instanceof TransferTx) {
        const data = tx.data;
        const amt = data.amount;
        assert(amt.symbol === AssetSymbol.GOLD
                || amt.symbol === AssetSymbol.SILVER, 'unhandled symbol: ' + amt.symbol);
        if (data.from.equals(key)) {
          if (amt.symbol === AssetSymbol.GOLD) {
            gold = gold.sub(amt).sub(data.fee);
          } else if (amt.symbol === AssetSymbol.SILVER) {
            silver = silver.sub(amt).sub(data.fee);
          }
        } else if (data.to.equals(key)) {
          if (amt.symbol === AssetSymbol.GOLD) {
            gold = gold.add(amt);
          } else if (amt.symbol === AssetSymbol.SILVER) {
            silver = silver.add(amt);
          }
        }
      } else if (tx instanceof RewardTx) {
        if (!tx.data.to.equals(key)) {
          continue;
        }
        for (const r of tx.data.rewards) {
          assert(r.symbol === AssetSymbol.GOLD
            || r.symbol === AssetSymbol.SILVER, 'unhandled symbol: ' + r.symbol);
          if (r.symbol === AssetSymbol.GOLD) gold = gold.add(r);
          else if (r.symbol === AssetSymbol.SILVER) silver = silver.add(r);
        }
      }
    }
    return {
      gold,
      silver
    };
  }
}
