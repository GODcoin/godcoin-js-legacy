import { Tx, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Asset, AssetSymbol } from '../asset';
import { Block, SignedBlock } from './block';
import { ChainStore } from './chain_store';
import { BigInteger } from 'big-integer';
import * as bigInt from 'big-integer';
import { Indexer } from '../indexer';
import * as assert from 'assert';
import * as Long from 'long';
import * as path from 'path';
import * as fs from 'fs';

export * from './block';

export class Blockchain {

  private genesisBlock!: SignedBlock;

  private readonly store: ChainStore;
  readonly indexer: Indexer;

  get head() {
    return this.store.blockHead;
  }

  constructor(dir: string) {
    const indexDir = path.join(dir, 'index');
    const logDir = path.join(dir, 'blklog');
    const indexDirExists = fs.existsSync(indexDir);
    const logDirExists = fs.existsSync(logDir);
    if (indexDirExists && !logDirExists) {
      throw new Error('Found index without blockchain log');
    } else if (!indexDirExists && logDirExists) {
      // TODO: support reindexing
      throw new Error('blockchain log needs to be reindexed');
    }
    this.indexer = new Indexer(indexDir);
    this.store = new ChainStore(logDir, this.indexer);
  }

  async start(): Promise<void> {
    await this.indexer.init();
    await this.store.init();
    this.genesisBlock = (await this.store.read(0))!;
  }

  async stop(): Promise<void> {
    await this.store.close();
    await this.indexer.close();
  }

  async addBlock(block: SignedBlock): Promise<void> {
    if (!this.store.blockHead && block.height.eq(0)) {
      // Write the genesis block directly
      this.genesisBlock = block;
      return this.store.write(block);
    }
    assert(this.store.blockHead.height.add(1).eq(block.height), 'unexpected height');
    assert(this.isBondValid(block.signing_key), 'invalid bond');
    block.validate(this.head);
    await this.store.write(block);
  }

  getBlock(num: number): Promise<SignedBlock|undefined> {
    return this.store.read(num);
  }

  async isBondValid(key: string|PublicKey): Promise<boolean> {
    if (typeof(key) === 'string') key = PublicKey.fromWif(key);
    return this.genesisBlock.signing_key.equals(key);
  }

  async getBalance(key: string|PublicKey): Promise<[Asset, Asset]> {
    if (typeof(key) === 'string') key = PublicKey.fromWif(key);
    const bal = await this.indexer.getBalance(key);
    if (!bal) {
      return [
        new Asset(bigInt(0), 0, AssetSymbol.GOLD),
        new Asset(bigInt(0), 0, AssetSymbol.SILVER)
      ];
    }
    return bal;
  }

  async setBalance(key: string|PublicKey,
                    balance: [Asset,Asset]): Promise<void> {
    if (typeof(key) === 'string') key = PublicKey.fromWif(key);
    await this.indexer.setBalance(key, balance[0], balance[1]);
  }
}
