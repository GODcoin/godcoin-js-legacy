import {
  deserialize,
  checkAsset,
  TransferTx,
  RewardTx,
  BondTx,
  Tx
} from '../transactions';
import { Asset, AssetSymbol, EMPTY_GOLD, EMPTY_SILVER } from '../asset';
import { Indexer, BatchIndex } from '../indexer';
import { ChainStore } from './chain_store';
import * as ByteBuffer from 'bytebuffer';
import { GODcoin } from '../constants';
import { PublicKey } from '../crypto';
import { SignedBlock } from './block';
import { EventEmitter } from 'events';
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

  private readonly lock = new Lock();
  private genesisBlock!: SignedBlock;
  private reindex = false;

  private readonly batchIndex: BatchIndex;
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
    this.batchIndex = this.prepareBatch();
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
        if (head) this.validateBlock(block, head);
        head = block;
        await batch.index(block, bytePos);
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
        this.genesisBlock = block;
      } else {
        await this.validateBlock(block, this.store.blockHead);
        assert(await this.isBondValid(block.signature_pair.public_key), 'invalid bond');
      }
      await this.batchIndex.index(block);
      await this.batchIndex.flush();
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

  async isBondValid(key: PublicKey): Promise<boolean> {
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
        if (tx instanceof TransferTx && tx.data.from.equals(addr)
            || tx instanceof BondTx && tx.data.staker.equals(addr)) ++txCount;
      }
    }

    for (let i = this.head.height; i.gte(0); i = i.sub(1)) {
      ++delta;
      const block = (await this.getBlock(i))!;
      for (const tx of block.transactions) {
        if (tx instanceof TransferTx && tx.data.from.equals(addr)
            || tx instanceof BondTx && tx.data.staker.equals(addr)) {
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
        } else if (tx instanceof BondTx && tx.data.staker.equals(addr)) {
          bal[0] = bal[0].sub(tx.data.fee).sub(tx.data.bond_fee).sub(tx.data.stake_amt);
        }
      }
    }
    return bal;
  }

  private async cacheNetworkFee(): Promise<void> {
    this._networkFee = await this.calcNetworkFee(this.head);
  }

  private async calcNetworkFee(block: SignedBlock): Promise<[Asset, Asset]> {
    // The network fee adjusts every 5 blocks so that users have a bigger time
    // frame to confirm the fee they want to spend without suddenly changing.
    const maxHeight = block.height.sub(block.height.mod(5));
    let minHeight = maxHeight.sub(GODcoin.NETWORK_FEE_AVG_WINDOW);
    if (minHeight.lt(0)) minHeight = Long.fromNumber(0, true);

    let txCount = 1;
    for (; minHeight.lte(maxHeight); minHeight = minHeight.add(1)) {
      const block = (await this.getBlock(minHeight))!;
      txCount += block.transactions.length;
    }
    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.NETWORK_FEE_GOLD_MULT.pow(txCount), 8);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.NETWORK_FEE_SILVER_MULT.pow(txCount), 8);
    return [goldFee, silverFee];
  }

  async validateBlock(block: SignedBlock, prevBlock: SignedBlock) {
    assert(prevBlock.height.add(1).eq(block.height), 'unexpected height');
    for (const tx of block.transactions) {
      // TODO: verify the tx is not a dup in the blockchain
      await this.validateTx(Buffer.from(tx.serialize(true).toBuffer()));
    }
    { // Verify merkle root recalculation
      const thisRoot = block.tx_merkle_root;
      const expectedRoot = block.getMerkleRoot();
      assert(expectedRoot.equals(thisRoot), 'unexpected merkle root');
    }

    {
      const prevHash = prevBlock.getHash();
      const curHash = block.previous_hash;
      assert(curHash.equals(prevHash), 'previous hash does not match');
    }
    {
      const serialized = block.serialize();
      const key = block.signature_pair.public_key;
      const sig = block.signature_pair.signature;
      assert(key.verify(sig, serialized), 'invalid signature');
    }
  }

  async validateTx(txBuf: Buffer, additionalTxs?: Tx[]): Promise<Tx> {
    assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
    const tx = deserialize<Tx>(ByteBuffer.wrap(txBuf));

    if (!(tx instanceof RewardTx)) {
      assert(tx.data.timestamp.getTime() < Date.now(), 'timestamp cannot be in the future');
      assert(tx.data.fee.amount.gt(0), 'fee must be greater than zero');
      checkAsset('fee', tx.data.fee);

      { // Validate time
        const exp = tx.data.timestamp.getTime();
        const now = Date.now();
        const delta = now - exp;
        assert(delta <= GODcoin.TX_EXPIRY_TIME, 'tx expired');
        assert(delta > 0, 'tx timestamp in the future');

        const timeTx = tx.data.timestamp.getTime();
        const timeHead = this.head.timestamp.getTime() - 3000;
        assert(timeTx > timeHead, 'timestamp cannot be behind 3 seconds of the block head time');
      }
    }

    if (tx instanceof RewardTx) {
      assert(tx.data.timestamp.getTime() === 0, 'reward must have 0 for time');
      assert(tx.data.signature_pairs.length === 0, 'reward must not be signed');
    } else if (tx instanceof TransferTx) {
      {
        assert.equal(tx.data.amount.symbol, tx.data.fee.symbol, 'fee must be paid with the same asset');
        assert(tx.data.amount.amount.geq(0), 'amount must be greater than or equal to zero');
        checkAsset('amount', tx.data.amount, tx.data.fee.symbol);
        if (tx.data.memo) {
          assert(tx.data.memo.length <= 512, 'maximum memo length is 512 bytes');
        }
        const buf = tx.serialize(false);
        const pair = tx.data.signature_pairs[0];
        assert(tx.data.from.verify(pair.signature, buf.toBuffer()), 'invalid signature');
      }

      let bal: Asset|undefined;
      let fee: Asset|undefined;
      if (tx.data.amount.symbol === AssetSymbol.GOLD) {
        bal = (await this.getBalance(tx.data.from, additionalTxs))[0];
        fee = (await this.getTotalFee(tx.data.from, additionalTxs))[0];
      } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
        bal = (await this.getBalance(tx.data.from, additionalTxs))[1];
        fee = (await this.getTotalFee(tx.data.from, additionalTxs))[1];
      }
      assert(bal, 'unknown balance symbol ' + tx.data.amount.symbol);
      assert(tx.data.fee.geq(fee!), 'fee amount too small, expected ' + fee!.toString());

      const remaining = bal!.sub(tx.data.amount).sub(tx.data.fee);
      assert(remaining.amount.geq(0), 'insufficient balance');
    } else if (tx instanceof BondTx) {
      {
        const data = tx.data;
        // For additional security, only allow unique minter and staker keys to
        // help prevent accidentally using hot wallets for minting
        assert(!data.minter.equals(data.staker), 'minter and staker keys must be unique');

        checkAsset('stake_amt', data.stake_amt, AssetSymbol.GOLD);
        checkAsset('bond_fee', data.bond_fee, AssetSymbol.GOLD);
        assert(data.stake_amt.amount.gt(0), 'stake_amt must be greater than zero');

        const buf = tx.serialize(false);

        assert(tx.data.signature_pairs.length === 2, 'transaction must be signed by the minter and staker');
        const minter = tx.data.signature_pairs[0];
        assert(tx.data.minter.verify(minter.signature, buf.toBuffer()), 'invalid signature');

        const staker = tx.data.signature_pairs[1];
        assert(tx.data.staker.verify(staker.signature, buf.toBuffer()), 'invalid signature');
      }

      // TODO: handle stake amount modifications
      const bal = (await this.getBalance(tx.data.staker, additionalTxs))[0];
      const fee = (await this.getTotalFee(tx.data.staker, additionalTxs))[0];
      assert(tx.data.fee.geq(fee), 'fee amount too small, expected ' + fee.toString());

      assert(tx.data.bond_fee.eq(GODcoin.BOND_FEE), 'invalid bond_fee');
      const remaining = bal.sub(fee).sub(tx.data.bond_fee).sub(tx.data.stake_amt);
      assert(remaining.amount.geq(0), 'insufficient balance');
    } else {
      throw new Error('invalid transaction');
    }

    return tx;
  }
}
