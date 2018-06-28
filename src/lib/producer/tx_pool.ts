import { Blockchain } from '../blockchain';
import { SkipFlags } from '../skip_flags';
import { GODcoin } from '../constants';
import { PublicKey } from '../crypto';
import { EventEmitter } from 'events';
import { Tx } from '../transactions';
import { Indexer } from '../indexer';
import { Asset } from '../asset';
import * as assert from 'assert';
import { Lock } from '../lock';

/**
 * Transaction pool as received by peers
 */
export class TxPool extends EventEmitter {

  private readonly lock = new Lock();
  private readonly indexer: Indexer;

  private txSet: {[key: string]: true} = {};
  private txs: Tx[] = [];

  constructor(readonly blockchain: Blockchain) {
    super();
    this.indexer = this.blockchain.indexer;
  }

  async push(txBuf: Buffer, hex: string): Promise<void> {
    await this.lock.lock();
    try {
      assert(!(await this.hasTx(txBuf, hex)), 'duplicate tx');
      const tx = await this.blockchain.validateTx(txBuf, {
        additional_txs: this.txs,
        skipFlags: SkipFlags.SKIP_NOTHING
      });

      this.txSet[hex] = true;
      const timeout = (tx.data.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME) - Date.now();
      setTimeout(() => {
        delete this.txSet[hex];
      }, timeout).unref();

      this.emit('tx', tx);
    } finally {
      this.lock.unlock();
    }
  }

  async hasTx(txBuf: Buffer, hex: string): Promise<boolean> {
    return await this.indexer.hasTx(txBuf) || this.txSet[hex] === true;
  }

  async popAll(): Promise<Tx[]> {
    await this.lock.lock();
    const txs = this.txs;
    this.txs = [];
    this.lock.unlock();
    return txs;
  }

  async getTotalFee(addr: PublicKey): Promise<[Asset,Asset]> {
    try {
      await this.lock.lock();
      return await this.blockchain.getTotalFee(addr, this.txs);
    } finally {
      this.lock.unlock();
    }
  }

  async getBalance(addr: PublicKey): Promise<[Asset,Asset]> {
    try {
      await this.lock.lock();
      return await this.blockchain.getBalance(addr, this.txs);
    } finally {
      this.lock.unlock();
    }
  }
}
