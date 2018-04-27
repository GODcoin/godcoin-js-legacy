import { Indexer, IndexProp, BalanceMap } from '../indexer';
import { Tx, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Asset, AssetSymbol } from '../asset';
import { Block, SignedBlock } from './block';
import { ChainStore } from './chain_store';
import { BigInteger } from 'big-integer';
import { GODcoin } from '../constants';
import * as bigInt from 'big-integer';
import * as Codec from 'level-codec';
import * as assert from 'assert';
import { Lock } from '../lock';
import * as Long from 'long';
import * as path from 'path';
import * as del from 'del';
import * as fs from 'fs';

export * from './block';

const jsonCodec = new Codec({
  keyEncoding: 'binary',
  valueEncoding: 'json'
})

export class Blockchain {

  private readonly dir: string;
  private get indexDir() { return path.join(this.dir, 'index'); }
  private get logDir() { return path.join(this.dir, 'blklog'); }

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
  }

  async start(): Promise<void> {
    await this.indexer.init();
    await this.store.init();
    this.genesisBlock = (await this.store.read(0))!;
    if (this.reindex) {
      console.log('Reindexing blockchain...');
      const start = Date.now();

      let head: SignedBlock|undefined;
      let ops: any[] = [];
      const balances = new BalanceMap(this.getBalance.bind(this));

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
        if (head) block.validate(head);
        head = block;
        await this.indexBlock(balances, head);
        {
          const buf = Buffer.allocUnsafe(8);
          buf.writeInt32BE(head.height.high, 0, true);
          buf.writeInt32BE(head.height.low, 4, true);

          const val = Long.fromNumber(bytePos, true);
          const pos = Buffer.allocUnsafe(8);
          pos.writeInt32BE(val.high, 0, true);
          pos.writeInt32BE(val.low, 4, true);

          ops.push({
            type: 'put',
            key: Buffer.concat([IndexProp.NAMESPACE_BLOCK, buf]),
            value: pos
          });
          if (ops.length >= 1000) {
            await new Promise<void>((res, rej) => {
              const batch = this.indexer.db.db.batch(ops, err => {
                if (err) return rej(err);
                res();
              });
            });
            ops.length = 0;
          }
        }
        if (head.height.mod(1000).eq(0)) {
          console.log('=> Indexed block:', head.height.toString());
        }
      });

      if (head) {
        if (ops.length > 0) {
          await new Promise<void>((res, rej) => {
            const batch = this.indexer.db.db.batch(ops, err => {
              if (err) return rej(err);
              res();
            });
          });
          ops.length = 0;
        }
        await this.indexer.setChainHeight(head.height);
        await this.writeBalanceMap(balances);
        await this.store.reload();
        this.genesisBlock = (await this.store.read(0))!;
      }
      const end = Date.now();
      console.log(`Finished indexing in ${end - start}ms`);
    }
    if (this.head) {
      await this.cacheNetworkFee();
    }
  }

  async stop(): Promise<void> {
    await this.lock.lock();
    try {
      await this.store.close();
      await this.indexer.close();
    } finally {
      this.lock.unlock();
    }
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
        assert(this.isBondValid(block.signing_key), 'invalid bond');
        block.validate(this.head);
        await this.store.write(block);
      }
      const balances = new BalanceMap(this.getBalance.bind(this));
      await this.indexBlock(balances, block);
      await this.writeBalanceMap(balances);
      await this.cacheNetworkFee();
    } finally {
      this.lock.unlock();
    }
  }

  getBlock(num: number|Long): Promise<SignedBlock|undefined> {
    return this.store.read(num);
  }

  async isBondValid(key: string|PublicKey): Promise<boolean> {
    if (typeof(key) === 'string') key = PublicKey.fromWif(key);
    return this.genesisBlock.signing_key.equals(key);
  }

  async getTotalFee(addr: PublicKey): Promise<[Asset,Asset]> {
    const addrFee = await this.getAddressFee(addr);
    const netFee = this.networkFee;
    return [
      netFee[0].add(addrFee[0]),
      netFee[1].add(addrFee[1])
    ];
  }

  async getAddressFee(addr: PublicKey): Promise<[Asset, Asset]> {
    // TODO: apply indexing
    let delta = 0;
    let txCount = 1;
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
    }

    const goldFee = GODcoin.MIN_GOLD_FEE.pow(txCount, 8);
    const silverFee = GODcoin.MIN_SILVER_FEE.pow(txCount, 8);
    return [goldFee, silverFee];
  }

  async getBalance(key: PublicKey): Promise<[Asset, Asset]> {
    const bal = await this.indexer.getBalance(key);
    if (!bal) {
      return [
        new Asset(bigInt(0), 0, AssetSymbol.GOLD),
        new Asset(bigInt(0), 0, AssetSymbol.SILVER)
      ];
    }
    return bal;
  }

  private async cacheNetworkFee(): Promise<void> {
    // The network fee adjusts every 5 blocks so that users have a bigger time
    // frame to confirm the fee they want to spend without suddenly changing.
    const maxHeight = this.head.height.sub(this.head.height.mod(5));
    let minHeight = maxHeight.sub(GODcoin.NETWORK_FEE_AVG_WINDOW);
    if (minHeight.lt(0)) minHeight = Long.fromNumber(0, true);

    let goldFee = GODcoin.MIN_GOLD_FEE;
    let silverFee = GODcoin.MIN_SILVER_FEE;
    for (; minHeight.lte(maxHeight); minHeight = minHeight.add(1)) {
      const block = (await this.getBlock(minHeight))!;
      goldFee = goldFee.mul(GODcoin.NETWORK_FEE_GOLD_MULT.pow(block.transactions.length), 8);
      silverFee = silverFee.mul(GODcoin.NETWORK_FEE_SILVER_MULT.pow(block.transactions.length), 8);
    }
    this._networkFee = [goldFee, silverFee];
  }

  private async indexBlock(balances: BalanceMap,
                            block: SignedBlock): Promise<void> {
    for (const tx of block.transactions) {
      if (tx instanceof TransferTx) {
        const fromBal = await balances.getBal(tx.data.from);
        const toBal = await balances.getBal(tx.data.to);
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
        const toBal = await balances.getBal(tx.data.to);
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

  private async writeBalanceMap(balances: BalanceMap): Promise<void> {
    if (balances.count <= 0) return;
    const batch = this.indexer.db.db.batch();
    batch.codec = jsonCodec; // Workaround for encoding-down
    for (const [hex, assets] of Object.entries(balances.flush())) {
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
}
