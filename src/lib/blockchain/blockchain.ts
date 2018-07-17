/// <reference path="../../../typings/bigint.d.ts" />

import * as assert from 'assert';
import * as ByteBuffer from 'bytebuffer';
import * as del from 'del';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as Long from 'long';
import * as path from 'path';
import { Asset, AssetSymbol, EMPTY_GOLD, EMPTY_SILVER } from '../asset';
import { GODcoin } from '../constants';
import { PublicKey } from '../crypto';
import { BatchIndex, Indexer } from '../indexer';
import { Lock } from '../lock';
import { SkipFlags } from '../skip_flags';
import {
  addBalAgnostic,
  BondTx,
  checkAsset,
  deserialize,
  RewardTx,
  subBalAgnostic,
  TransferTx,
  Tx
} from '../transactions';
import { SignedBlock } from './block';
import { ChainStore } from './chain_store';

export * from './block';

export interface ValidateOpts {
  additional_txs?: Tx[];
  skipFlags: SkipFlags;
}

export class Blockchain extends EventEmitter {

  get networkFee() {
    return this._networkFee;
  }

  get head() {
    return this.store.blockHead;
  }

  readonly indexer: Indexer;

  private running = false;

  private readonly dir: string;
  private get indexDir() { return path.join(this.dir, 'index'); }
  private get logDir() { return path.join(this.dir, 'blklog'); }

  private readonly lock = new Lock();
  private genesisBlock!: SignedBlock;
  private reindex = false;

  private readonly batchIndex: BatchIndex;
  private readonly store: ChainStore;

  private _networkFee!: [Asset, Asset];

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
    this.running = true;
    await this.indexer.init();
    await this.store.init();

    if (this.reindex) {
      console.log('Reindexing blockchain...');
      const start = Date.now();

      const batch = this.prepareBatch();
      let head: SignedBlock|undefined;

      const skipFlags = SkipFlags.SKIP_BLOCK_MERKLE | SkipFlags.SKIP_TX;
      await this.store.readBlockLog(async (err, block, bytePos) => {
        if (!this.running) return;
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
        if (head && block.height.lte(head.height)) {
          console.log('Unexpected height during reindexing:', block.height.toString());
          console.log('Trimming the block log to height', head.height.toString());
          await this.store.chop(head.height);
          return;
        }

        if (head) await this.validateBlock(block, head, skipFlags);
        head = block;
        await batch.index(block, bytePos);
      });
      if (!this.running) return;

      if (head) await batch.flush();
      const end = Date.now();
      console.log(`Finished indexing in ${end - start}ms`);
    }

    await this.reload();
  }

  async stop(): Promise<void> {
    this.running = false;
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

  async addBlock(block: SignedBlock, skipFlags?: SkipFlags): Promise<void> {
    try {
      await this.lock.lock();
      if (!this.store.blockHead && block.height.eq(0)) {
        this.genesisBlock = block;
      } else {
        await this.validateBlock(block, this.store.blockHead, skipFlags);
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

  async isBondValid(block: SignedBlock): Promise<boolean> {
    const m = block.signature_pair.public_key;
    return (await this.indexer.getBond(m)) !== undefined
            || this.genesisBlock.signature_pair.public_key.equals(m);
  }

  async getTotalFee(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset, Asset]> {
    const addrFee = await this.getAddressFee(addr, additionalTxs);
    const netFee = this.networkFee;
    return [
      netFee[0].add(addrFee[0]),
      netFee[1].add(addrFee[1])
    ];
  }

  async getAddressFee(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset, Asset]> {
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

    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.GOLD_FEE_MULT.pow(txCount), Asset.MAX_PRECISION);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.SILVER_FEE_MULT.pow(txCount), Asset.MAX_PRECISION);
    return [goldFee, silverFee];
  }

  async getBalance(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset, Asset]> {
    let bal = await this.indexer.getBalance(addr);
    if (!bal) bal = [EMPTY_GOLD, EMPTY_SILVER];
    if (additionalTxs) {
      for (const tx of additionalTxs) {
        if (tx instanceof TransferTx) {
          if (tx.data.from.equals(addr)) {
            subBalAgnostic(bal, tx.data.amount);
            subBalAgnostic(bal, tx.data.fee);
          } else if (tx.data.to.equals(addr)) {
            addBalAgnostic(bal, tx.data.amount);
          }
        } else if (tx instanceof BondTx && tx.data.staker.equals(addr)) {
          subBalAgnostic(bal, tx.data.fee);
          subBalAgnostic(bal, tx.data.bond_fee);
          subBalAgnostic(bal, tx.data.stake_amt);
        } else if (tx instanceof RewardTx && tx.data.to.equals(addr)) {
          for (const reward of tx.data.rewards) addBalAgnostic(bal, reward);
        }
      }
    }
    return bal;
  }

  async validateBlock(block: SignedBlock,
                      prevBlock: SignedBlock,
                      skipFlags = SkipFlags.SKIP_NOTHING) {
    assert(prevBlock.height.add(1).eq(block.height), 'unexpected height');
    if ((skipFlags & SkipFlags.SKIP_BLOCK_BOND_SIGNER) === 0) {
      assert(await this.isBondValid(block), 'invalid bond');
    }

    if ((skipFlags & SkipFlags.SKIP_TX) === 0) {
      const opts: ValidateOpts = { skipFlags };
      for (const tx of block.transactions) {
        const buf = Buffer.from(tx.serialize(true).toBuffer());
        await this.validateTx(buf, opts);
        if (!(tx instanceof RewardTx)) {
          await this.indexer.addTx(buf, tx.data.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME);
        }
      }
    }
    if ((skipFlags & SkipFlags.SKIP_BLOCK_MERKLE) === 0) {
      // Verify merkle root recalculation
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

  async validateTx(txBuf: Buffer, opts: ValidateOpts = {
                                    skipFlags: SkipFlags.SKIP_NOTHING
                                  }): Promise<Tx> {
    assert((opts.skipFlags & SkipFlags.SKIP_TX) === 0, 'cannot skip tx in tx validator');
    assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
    const tx = deserialize<Tx>(ByteBuffer.wrap(txBuf));

    if (!(tx instanceof RewardTx)) {
      assert(tx.data.timestamp.getTime() < Date.now(), 'timestamp cannot be in the future');
      assert(tx.data.fee.amount > 0, 'fee must be greater than zero');
      checkAsset('fee', tx.data.fee);

      if ((opts.skipFlags & SkipFlags.SKIP_TX_TIME) === 0) {
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
      if ((opts.skipFlags & SkipFlags.SKIP_TX_TIME) === 0) {
        assert(tx.data.timestamp.getTime() === 0, 'reward must have 0 for time');
      }
      assert(tx.data.signature_pairs.length === 0, 'reward must not be signed');
    } else if (tx instanceof TransferTx) {
      {
        assert.equal(tx.data.amount.symbol, tx.data.fee.symbol, 'fee must be paid with the same asset');
        assert(tx.data.amount.amount > 0, 'amount must be greater than or equal to zero');
        checkAsset('amount', tx.data.amount, tx.data.fee.symbol);
        if (tx.data.memo) {
          assert(tx.data.memo.length <= 512, 'maximum memo length is 512 bytes');
        }
      }

      if ((opts.skipFlags & SkipFlags.SKIP_TX_SIGNATURE) === 0) {
        const buf = tx.serialize(false);
        const pair = tx.data.signature_pairs[0];
        assert(tx.data.from.verify(pair.signature, buf.toBuffer()), 'invalid signature');
      }

      let bal: Asset|undefined;
      let fee: Asset|undefined;
      if (tx.data.amount.symbol === AssetSymbol.GOLD) {
        bal = (await this.getBalance(tx.data.from, opts.additional_txs))[0];
        fee = (await this.getTotalFee(tx.data.from, opts.additional_txs))[0];
      } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
        bal = (await this.getBalance(tx.data.from, opts.additional_txs))[1];
        fee = (await this.getTotalFee(tx.data.from, opts.additional_txs))[1];
      }
      assert(bal, 'unknown balance symbol ' + tx.data.amount.symbol);
      assert(tx.data.fee.geq(fee!), 'fee amount too small, expected ' + fee!.toString());

      const remaining = bal!.sub(tx.data.amount).sub(tx.data.fee);
      assert(remaining.amount >= BigInt(0), 'insufficient balance');
    } else if (tx instanceof BondTx) {
      {
        const data = tx.data;
        // For additional security, only allow unique minter and staker keys to
        // help prevent accidentally using hot wallets for minting
        assert(!data.minter.equals(data.staker), 'minter and staker keys must be unique');

        checkAsset('stake_amt', data.stake_amt, AssetSymbol.GOLD);
        checkAsset('bond_fee', data.bond_fee, AssetSymbol.GOLD);
        assert(data.stake_amt.amount > 0, 'stake_amt must be greater than zero');

        const buf = tx.serialize(false);

        assert(tx.data.signature_pairs.length === 2, 'transaction must be signed by the minter and staker');
        const minter = tx.data.signature_pairs[0];
        assert(tx.data.minter.verify(minter.signature, buf.toBuffer()), 'invalid signature');

        const staker = tx.data.signature_pairs[1];
        assert(tx.data.staker.verify(staker.signature, buf.toBuffer()), 'invalid signature');
      }

      // TODO: handle stake amount modifications
      const bal = (await this.getBalance(tx.data.staker, opts.additional_txs))[0];
      const fee = (await this.getTotalFee(tx.data.staker, opts.additional_txs))[0];
      assert(tx.data.fee.geq(fee), 'fee amount too small, expected ' + fee.toString());

      assert(tx.data.bond_fee.eq(GODcoin.BOND_FEE), 'invalid bond_fee');
      const remaining = bal.sub(fee).sub(tx.data.bond_fee).sub(tx.data.stake_amt);
      assert(remaining.amount >= 0, 'insufficient balance');
    } else {
      throw new Error('invalid transaction');
    }

    return tx;
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
      txCount += (await this.getBlock(minHeight))!.transactions.length;
    }
    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.NETWORK_FEE_GOLD_MULT.pow(txCount), Asset.MAX_PRECISION);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.NETWORK_FEE_SILVER_MULT.pow(txCount), Asset.MAX_PRECISION);
    return [goldFee, silverFee];
  }
}
