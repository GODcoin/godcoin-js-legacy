import * as assert from 'assert';
import * as del from 'del';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import {
  Asset,
  AssetSymbol,
  BondTx,
  PublicKey,
  RewardTx,
  SignedBlock,
  TransferTx,
  Tx
} from 'godcoin-neon';
import * as path from 'path';
import {
  addBalAgnostic,
  checkAsset,
  subBalAgnostic
} from '../asset';
import { GODcoin } from '../constants';
import { BlockIndexer, Indexer } from '../indexer';
import { Lock } from '../lock';
import { SkipFlags } from '../skip_flags';
import { ChainStore } from './chain_store';

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

  private readonly batchIndex: BlockIndexer;
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
        if (head && block.height <= head.height) {
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

  prepareBatch(): BlockIndexer {
    return new BlockIndexer(this.indexer, this.store, this.getBalance.bind(this));
  }

  async addBlock(block: SignedBlock, skipFlags?: SkipFlags): Promise<void> {
    try {
      await this.lock.lock();
      if (!this.store.blockHead && block.height === 0) {
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

  getBlock(height: number): Promise<SignedBlock|undefined> {
    return this.store.read(height);
  }

  async isBondValid(block: SignedBlock): Promise<boolean> {
    const m = block.sig_pair[0];
    return (await this.indexer.getBond(m)) !== undefined
            || this.genesisBlock.sig_pair[0].equals(m);
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
        if (tx instanceof TransferTx && tx.from.equals(addr)
            || tx instanceof BondTx && tx.staker.equals(addr)) ++txCount;
      }
    }

    for (let i = this.head.height; i <= 0; --i) {
      ++delta;
      const block = (await this.getBlock(i))!;
      for (const tx of block.transactions) {
        if (tx instanceof TransferTx && tx.from.equals(addr)
            || tx instanceof BondTx && tx.staker.equals(addr)) {
          ++txCount;
          delta = 0;
        }
      }
      if (delta === GODcoin.FEE_RESET_WINDOW) break;
      else if (i === 0) break;
    }

    const prec = Asset.MAX_PRECISION;
    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.GOLD_FEE_MULT.pow(txCount, prec), prec);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.SILVER_FEE_MULT.pow(txCount, prec), prec);
    return [goldFee, silverFee];
  }

  async getBalance(addr: PublicKey, additionalTxs?: Tx[]): Promise<[Asset, Asset]> {
    let bal = await this.indexer.getBalance(addr);
    if (!bal) bal = [Asset.EMPTY_GOLD, Asset.EMPTY_SILVER];
    if (additionalTxs) {
      for (const tx of additionalTxs) {
        if (tx instanceof TransferTx) {
          if (tx.from.equals(addr)) {
            subBalAgnostic(bal, tx.amount);
            subBalAgnostic(bal, tx.fee);
          } else if (tx.to.equals(addr)) {
            addBalAgnostic(bal, tx.amount);
          }
        } else if (tx instanceof BondTx && tx.staker.equals(addr)) {
          subBalAgnostic(bal, tx.fee);
          subBalAgnostic(bal, tx.bond_fee);
          subBalAgnostic(bal, tx.stake_amt);
        } else if (tx instanceof RewardTx && tx.to.equals(addr)) {
          for (const reward of tx.rewards) addBalAgnostic(bal, reward);
        }
      }
    }
    return bal;
  }

  async validateBlock(block: SignedBlock,
                      prevBlock: SignedBlock,
                      skipFlags = SkipFlags.SKIP_NOTHING) {
    assert(prevBlock.height + 1 === block.height, 'unexpected height');
    if ((skipFlags & SkipFlags.SKIP_BLOCK_BOND_SIGNER) === 0) {
      assert(await this.isBondValid(block), 'invalid bond');
    }

    if ((skipFlags & SkipFlags.SKIP_TX) === 0) {
      const opts: ValidateOpts = { skipFlags };
      for (const tx of block.transactions) {
        const buf = tx.encodeWithSigs();
        await this.validateTx(buf, opts);
        if (!(tx instanceof RewardTx)) {
          await this.indexer.addTx(buf, tx.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME);
        }
      }
    }
    if ((skipFlags & SkipFlags.SKIP_BLOCK_MERKLE) === 0) {
      // Verify merkle root recalculation
      assert(block.verifyMerkleRoot(), 'unexpected merkle root');
    }

    {
      const prevHash = prevBlock.calcHash();
      const curHash = block.previous_hash;
      assert(curHash.equals(prevHash), 'previous hash does not match');
    }
    {
      const header = block.encodeHeader();
      const key = block.sig_pair[0];
      const sig = block.sig_pair[1];
      assert(key.verify(sig, header), 'invalid signature');
    }
  }

  async validateTx(txBuf: Buffer, opts: ValidateOpts = {
                                    skipFlags: SkipFlags.SKIP_NOTHING
                                  }): Promise<Tx> {
    assert((opts.skipFlags & SkipFlags.SKIP_TX) === 0, 'cannot skip tx in tx validator');
    assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
    const tx = Tx.decodeWithSigs(txBuf);
    if (tx === null) {
      throw new Error('failed to decode tx');
    }

    if (!(tx instanceof RewardTx)) {
      assert(tx.timestamp.getTime() < Date.now(), 'timestamp cannot be in the future');
      assert(tx.fee.amount > 0, 'fee must be greater than zero');
      checkAsset('fee', tx.fee);

      if ((opts.skipFlags & SkipFlags.SKIP_TX_TIME) === 0) {
        const exp = tx.timestamp.getTime();
        const now = Date.now();
        const delta = now - exp;
        assert(delta <= GODcoin.TX_EXPIRY_TIME, 'tx expired');
        assert(delta > 0, 'tx timestamp in the future');

        const timeTx = tx.timestamp.getTime();
        const timeHead = this.head.timestamp.getTime() - 3000;
        assert(timeTx > timeHead, 'timestamp cannot be behind 3 seconds of the block head time');
      }
    }

    if (tx instanceof RewardTx) {
      if ((opts.skipFlags & SkipFlags.SKIP_TX_TIME) === 0) {
        assert(tx.timestamp.getTime() === 0, 'reward must have 0 for time');
      }
      assert(tx.signature_pairs.length === 0, 'reward must not be signed');
    } else if (tx instanceof TransferTx) {
      {
        assert.equal(tx.amount.symbol, tx.fee.symbol, 'fee must be paid with the same asset');
        assert(tx.amount.amount > 0, 'amount must be greater than or equal to zero');
        checkAsset('amount', tx.amount, tx.fee.symbol);
        if (tx.memo) {
          assert(tx.memo.length <= 512, 'maximum memo length is 512 bytes');
        }
      }

      if ((opts.skipFlags & SkipFlags.SKIP_TX_SIGNATURE) === 0) {
        const buf = tx.encode();
        const pair = tx.signature_pairs[0];
        assert(tx.from.verify(pair[1], buf), 'invalid signature');
      }

      let bal: Asset|undefined;
      let fee: Asset|undefined;
      if (tx.amount.symbol === AssetSymbol.GOLD) {
        bal = (await this.getBalance(tx.from, opts.additional_txs))[0];
        fee = (await this.getTotalFee(tx.from, opts.additional_txs))[0];
      } else if (tx.amount.symbol === AssetSymbol.SILVER) {
        bal = (await this.getBalance(tx.from, opts.additional_txs))[1];
        fee = (await this.getTotalFee(tx.from, opts.additional_txs))[1];
      }
      assert(bal, 'unknown balance symbol ' + tx.amount.symbol);
      assert(tx.fee.geq(fee!), 'fee amount too small, expected ' + fee!.toString());

      const remaining = bal!.sub(tx.amount).sub(tx.fee);
      assert(remaining.amount >= 0, 'insufficient balance');
    } else if (tx instanceof BondTx) {
      {
        // For additional security, only allow unique minter and staker keys to
        // help prevent accidentally using hot wallets for minting
        assert(!tx.minter.equals(tx.staker), 'minter and staker keys must be unique');

        checkAsset('stake_amt', tx.stake_amt, AssetSymbol.GOLD);
        checkAsset('bond_fee', tx.bond_fee, AssetSymbol.GOLD);
        assert(tx.stake_amt.amount > 0, 'stake_amt must be greater than zero');

        const buf = tx.encode();

        assert(tx.signature_pairs.length === 2, 'transaction must be signed by the minter and staker');
        const minter = tx.signature_pairs[0];
        assert(tx.minter.verify(minter[1], buf), 'invalid signature');

        const staker = tx.signature_pairs[1];
        assert(tx.staker.verify(staker[1], buf), 'invalid signature');
      }

      // TODO: handle stake amount modifications
      const bal = (await this.getBalance(tx.staker, opts.additional_txs))[0];
      const fee = (await this.getTotalFee(tx.staker, opts.additional_txs))[0];
      assert(tx.fee.geq(fee), 'fee amount too small, expected ' + fee.toString());

      assert(tx.bond_fee.eq(GODcoin.BOND_FEE), 'invalid bond_fee');
      const remaining = bal.sub(fee).sub(tx.bond_fee).sub(tx.stake_amt);
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
    const maxHeight = block.height - (block.height % 5);
    let minHeight = maxHeight - GODcoin.NETWORK_FEE_AVG_WINDOW;
    if (minHeight < 0) minHeight = 0;

    let txCount = 1;
    for (; minHeight <= maxHeight; ++minHeight) {
      txCount += (await this.getBlock(minHeight))!.transactions.length;
    }
    const prec = Asset.MAX_PRECISION;
    const goldFee = GODcoin.MIN_GOLD_FEE.mul(GODcoin.NETWORK_FEE_GOLD_MULT.pow(txCount, prec), prec);
    const silverFee = GODcoin.MIN_SILVER_FEE.mul(GODcoin.NETWORK_FEE_SILVER_MULT.pow(txCount, prec), prec);
    return [goldFee, silverFee];
  }
}
