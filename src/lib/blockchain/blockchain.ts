import { Asset, AssetSymbol, EMPTY_GOLD, EMPTY_SILVER } from '../asset';
import { Indexer, IndexProp, BalanceMap } from '../indexer';
import { Tx, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Block, SignedBlock } from './block';
import { ChainStore } from './chain_store';
import { BigInteger } from 'big-integer';
import { GODcoin } from '../constants';
import { EventEmitter } from 'events';
import * as bigInt from 'big-integer';
import * as Codec from 'level-codec';
import { BatchIndex } from './batch';
import * as assert from 'assert';
import { Lock } from '../lock';
import * as Long from 'long';
import * as path from 'path';
import * as del from 'del';
import * as fs from 'fs';

export * from './block';

export class Blockchain extends EventEmitter {

  private readonly dir: string;
  private get indexDir() { return path.join(this.dir, 'index'); }
  private get logDir() { return path.join(this.dir, 'blklog'); }

  private readonly balances: BalanceMap;
  private readonly lock = new Lock();
  private genesisBlock!: SignedBlock;
  private reindex = false;

  private readonly store: ChainStore;
  readonly indexer: Indexer;

  private _networkFee!: [Asset, Asset];
  get networkFee() {
    return this._networkFee;
  }

  get head() {
    return this.store.blockHead;
  }

  constructor(dir: string, reindex = false) {
    super();
    this.dir = dir;
    this.reindex = reindex;
    const indexDirExists = fs.existsSync(this.indexDir);
    const logDirExists = fs.existsSync(this.logDir);
    if (indexDirExists && !logDirExists) {
      throw new Error('Found index without blockchain log');
    } else if (!reindex && (!indexDirExists && logDirExists)) {
      throw new Error('blockchain needs to be reindexed');
    } else if (reindex && indexDirExists) {
      del.sync(this.indexDir, {
        force: true
      });
    }
    if (reindex && !logDirExists) reindex = false;
    this.indexer = new Indexer(this.indexDir);
    this.store = new ChainStore(this.logDir, this.indexer);
    this.balances = new BalanceMap(this.indexer, this.getBalance.bind(this));
  }

  async start(): Promise<void> {
    await this.indexer.init();
    await this.store.init();

    if (this.reindex) {
      console.log('Reindexing blockchain...');
      const start = Date.now();

      const batch = this.prepareBatch();
      let head: SignedBlock|undefined;

      await this.store.readBlockLog(async (err, block, bytePos) => {
        if (err) {
          console.log('Error during reindexing', err);
          if (head) {
            console.log('Trimming the block log to height', head.height.toString());
            await this.store.chop(head.height);
          } else {
            throw new Error('unable to proceed');
          }
          return;
        }
        head = block;
        batch.index(block, bytePos);
      });

      if (head) {
        await batch.flush();
        await this.indexer.setChainHeight(head.height);
      }
      const end = Date.now();
      console.log(`Finished indexing in ${end - start}ms`);
    }

    await this.reload();
  }

  async stop(): Promise<void> {
    await this.lock.lock();
    try {
      this.removeAllListeners();
      await this.store.close();
      await this.indexer.close();
    } finally {
      this.lock.unlock();
    }
  }

  async reload(): Promise<void> {
    await this.store.postInit();
    this.genesisBlock = (await this.getBlock(0))!;
    if (this.head) await this.cacheNetworkFee();
  }

  prepareBatch(): BatchIndex {
    return new BatchIndex(this.indexer, this.store, this.getBalance.bind(this));
  }

  async addBlock(block: SignedBlock): Promise<void> {
    try {
      await this.lock.lock();
      if (!this.store.blockHead && block.height.eq(0)) {
        // Write the genesis block directly
        this.genesisBlock = block;
        await this.store.write(block);
      } else {
        assert(this.store.blockHead.height.add(1).eq(block.height), 'unexpected height');
        assert(this.isBondValid(block.signature_pair.public_key), 'invalid bond');
        block.validate(this.head);
        await this.store.write(block);
      }
      await this.balances.update(block);
      await this.balances.write();
      await this.cacheNetworkFee();
      this.emit('block', block);
    } finally {
      this.lock.unlock();
    }
  }

  getBlock(height: number|Long): Promise<SignedBlock|undefined> {
    if (typeof(height) === 'number') height = Long.fromNumber(height, true);
    return this.store.read(height);
  }

  async isBondValid(key: string|PublicKey): Promise<boolean> {
    if (typeof(key) === 'string') key = PublicKey.fromWif(key);
    return this.genesisBlock.signature_pair.public_key.equals(key);
  }

  async getTotalFee(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset,Asset]> {
    const addrFee = await this.getAddressFee(addr, additionalTxs);
    const netFee = this.networkFee;
    return [
      netFee[0].add(addrFee[0]),
      netFee[1].add(addrFee[1])
    ];
  }

  async getAddressFee(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset,Asset]> {
    // TODO: apply indexing
    let delta = 0;
    let txCount = 1;

    if (additionalTxs) {
      for (const tx of additionalTxs) {
        if (tx instanceof TransferTx && tx.data.from.equals(addr)) ++txCount;
      }
    }

    for (let i = this.head.height; i.gte(0); i = i.sub(1)) {
      ++delta;
      const block = (await this.getBlock(i))!;
      for (const tx of block.transactions) {
        if (tx instanceof TransferTx && tx.data.from.equals(addr)) {
          ++txCount;
          delta = 0;
        }
      }
      if (delta === GODcoin.FEE_RESET_WINDOW) break;
      else if (i.eq(0)) break;
    }

    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.GOLD_FEE_MULT.pow(txCount), 8);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.SILVER_FEE_MULT.pow(txCount), 8);
    return [goldFee, silverFee];
  }

  async getBalance(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset,Asset]> {
    let bal = await this.indexer.getBalance(addr);
    if (!bal) bal = [EMPTY_GOLD, EMPTY_SILVER];
    if (additionalTxs) {
      for (const tx of additionalTxs) {
        if (tx instanceof TransferTx) {
          if (tx.data.from.equals(addr)) {
            if (tx.data.amount.symbol === AssetSymbol.GOLD) {
              bal[0] = bal[0].sub(tx.data.amount).sub(tx.data.fee);
            } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
              bal[1] = bal[1].sub(tx.data.amount).sub(tx.data.fee);
            } else {
              throw new Error('unhandled symbol: ' + tx.data.amount.symbol);
            }
          } else if (tx.data.to.equals(addr)) {
            if (tx.data.amount.symbol === AssetSymbol.GOLD) {
              bal[0] = bal[0].add(tx.data.amount);
            } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
              bal[1] = bal[1].add(tx.data.amount);
            } else {
              throw new Error('unhandled symbol: ' + tx.data.amount.symbol);
            }
          }
        }
      }
    }
    return bal;
  }

  private async cacheNetworkFee(): Promise<void> {
    // The network fee adjusts every 5 blocks so that users have a bigger time
    // frame to confirm the fee they want to spend without suddenly changing.
    const maxHeight = this.head.height.sub(this.head.height.mod(5));
    let minHeight = maxHeight.sub(GODcoin.NETWORK_FEE_AVG_WINDOW);
    if (minHeight.lt(0)) minHeight = Long.fromNumber(0, true);

    let txCount = 1;
    for (; minHeight.lte(maxHeight); minHeight = minHeight.add(1)) {
      const block = (await this.getBlock(minHeight))!;
      txCount += block.transactions.length;

    }
    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.NETWORK_FEE_GOLD_MULT.pow(txCount), 8);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.NETWORK_FEE_SILVER_MULT.pow(txCount), 8);
    this._networkFee = [goldFee, silverFee];
  }
}
