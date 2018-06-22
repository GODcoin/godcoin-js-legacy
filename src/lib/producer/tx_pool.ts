import { deserialize, Tx, TransferTx, BondTx } from '../transactions';
import { AssetSymbol, Asset } from '../asset';
import { Blockchain } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { GODcoin } from '../constants';
import { PublicKey } from '../crypto';
import { EventEmitter } from 'events';
import { Indexer } from '../indexer';
import * as assert from 'assert';
import { Lock } from '../lock';

/**
 * Transaction pool as received by peers
 */
export class TxPool extends EventEmitter {

  private readonly lock = new Lock();
  private readonly indexer: Indexer;
  private txs: Tx[] = [];

  constructor(readonly blockchain: Blockchain) {
    super();
    this.indexer = this.blockchain.indexer;
  }

  async push(txBuf: Buffer): Promise<[Long, number]> {
    await this.lock.lock();
    try {
      assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
      const tx = await this.blockchain.validateTx(txBuf, this.txs);
      await this.indexer.addTx(txBuf, tx.data.timestamp!.getTime() + 60000);
      this.emit('tx', tx);
      return [this.blockchain.head.height.add(1), this.txs.push(tx) - 1];
    } finally {
      this.lock.unlock();
    }
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
