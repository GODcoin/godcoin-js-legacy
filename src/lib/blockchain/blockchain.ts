import { Tx, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Block, SignedBlock } from './block';
import { Asset, AssetSymbol } from '../asset';
import { ChainStore } from './chain_store';
import { BigInteger } from 'big-integer';
import * as bigInt from 'big-integer';
import * as mkdirp from 'mkdirp';
import * as assert from 'assert';
import * as Long from 'long';
import { Indexer } from '../indexer';
export * from './block';

export class Blockchain {

  private readonly store: ChainStore;
  private readonly indexer: Indexer;

  constructor(store: ChainStore, indexer: Indexer) {
    this.store = store;
    this.indexer = indexer;
  }

  async start(): Promise<void> {
    await this.store.init();
  }

  async stop(): Promise<void> {
    await this.indexer.close();
  }

  async addBlock(block: SignedBlock): Promise<void> {
    if (!this.store.blockHeight) {
      // Write the genesis block directly
      return await this.store.write(block);
    }
    assert(this.store.blockHeight.add(1).eq(block.height), 'unexpected height');
    assert(this.isBondValid(block.signing_key), 'invalid bond');
    block.validate(await this.getLatestBlock());
    await this.store.write(block);
  }

  async getLatestBlock(): Promise<SignedBlock> {
    return (await this.store.read(this.store.blockHeight))!;
  }

  async getBlock(num: number): Promise<SignedBlock|undefined> {
    return this.store.read(num);
  }

  async isBondValid(key: string|PublicKey): Promise<boolean> {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    return (await this.getBlock(0))!.signing_key.equals(key);
  }

  async getGoldBalance(key: string|PublicKey): Promise<Asset> {
    return this.getBalance(key, AssetSymbol.GOLD);
  }

  async getSilverBalance(key: string|PublicKey): Promise<Asset> {
    return this.getBalance(key, AssetSymbol.SILVER);
  }

  private async getBalance(key: string|PublicKey,
                            symbol: AssetSymbol): Promise<Asset> {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    let balance: Asset = new Asset(bigInt(0), 0, symbol);
    let i = Long.fromNumber(0, true);
    for (; i.lt(this.store.blockHeight); i = i.add(1)) {
      const block = await this.store.read(i);
      const bal = Blockchain.getBlockBalance(key, block!.transactions, symbol);
      balance = balance.add(bal);
    }
    return balance;
  }

  private static getBlockBalance(key: PublicKey,
                                  txs: Tx[],
                                  symbol: AssetSymbol): Asset {
    let balance: Asset = new Asset(bigInt(0), 0, symbol);
    for (const tx of txs) {
      if (tx instanceof TransferTx) {
        if (tx.data.amount.symbol !== symbol
                    || tx.data.from.equals(tx.data.to)) {
          balance = balance.sub(tx.data.fee);
          continue;
        }
        if (tx.data.from.equals(key)) {
          balance = balance.sub(tx.data.amount).sub(tx.data.fee);
        } else if (tx.data.to.equals(key)) {
          balance = balance.add(tx.data.amount);
        }
      } else if (tx instanceof RewardTx) {
        if (!tx.data.to.equals(key)) {
          continue;
        }
        for (const r of tx.data.rewards) {
          if (r.symbol === symbol) {
            balance = balance.add(r);
          }
        }
      }
    }
    return balance;
  }
}
