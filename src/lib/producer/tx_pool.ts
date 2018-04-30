import { Tx, TransferTx, deserialize } from '../transactions';
import { AssetSymbol, Asset } from '../asset';
import { Blockchain } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { Indexer } from '../indexer';
import * as assert from 'assert';
import * as crypto from 'crypto';
import { Lock } from '../lock';

/**
 * Transaction pool as received by peers
 */
export class TxPool {

  private readonly lock = new Lock();
  private readonly indexer: Indexer;
  private txs: Tx[] = [];

  constructor(readonly blockchain: Blockchain) {
    this.indexer = this.blockchain.indexer;
  }

  async push(txBuf: Buffer): Promise<[Long, number]> {
    await this.lock.lock();
    try {
      const tx = deserialize<Tx>(ByteBuffer.wrap(txBuf));
      tx.checkExpiry();
      if (tx instanceof TransferTx) {
        assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
        tx.validate();
        {
          const timeTx = tx.data.timestamp.getTime();
          const timeHead = this.blockchain.head.timestamp.getTime() - 5000;
          assert(timeTx > timeHead, 'timestamp cannot be behind 5 seconds of the block head time');
        }

        let bal: Asset|undefined;
        let fee: Asset|undefined;
        if (tx.data.amount.symbol === AssetSymbol.GOLD) {
          bal = (await this.blockchain.getBalance(tx.data.from, this.txs))[0];
          fee = (await this.blockchain.getTotalFee(tx.data.from, this.txs))[0];
        } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
          bal = (await this.blockchain.getBalance(tx.data.from, this.txs))[1];
          fee = (await this.blockchain.getTotalFee(tx.data.from, this.txs))[1];
        }
        assert(bal, 'unknown balance symbol ' + tx.data.amount.symbol);
        assert(tx.data.fee.geq(fee!), 'fee amount too small, expected ' + fee!.toString());
        const remaining = bal!.sub(tx.data.amount).sub(tx.data.fee);
        assert(remaining.amount.geq(0), 'insufficient balance');
        await this.indexer.addTx(txBuf, tx.data.timestamp!.getTime() + 60000);
        return [this.blockchain.head.height, this.txs.push(tx) - 1];
      }

      throw new Error('invalid transaction');
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
