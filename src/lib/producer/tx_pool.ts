import { Tx, TransferTx, deserialize } from '../transactions';
import { AssetSymbol, Asset } from '../asset';
import { Blockchain } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import * as assert from 'assert';
import * as crypto from 'crypto';
import { Lock } from '../lock';

/**
 * Transaction pool as received by peers
 */
export class TxPool {

  private readonly lock = new Lock();
  private txs: Tx[] = [];

  constructor(readonly blockchain: Blockchain) {
  }

  async push(txBuf: Buffer): Promise<number> {
    await this.lock.lock();
    try {
      const tx = deserialize<Tx>(ByteBuffer.wrap(txBuf));
      tx.checkExpiry();
      if (tx instanceof TransferTx) {
        assert(!(await this.blockchain.indexer.hasTx(txBuf)), 'duplicate tx');
        tx.validate();

        let bal: Asset|undefined;
        if (tx.data.amount.symbol === AssetSymbol.GOLD) {
          bal = await this.blockchain.getBalance(tx.data.from)[0];
        } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
          bal = await this.blockchain.getBalance(tx.data.from)[1];
        }
        assert(bal, 'unknown balance symbol ' + tx.data.amount.symbol);

        for (const poolTx of this.txs) {
          if (poolTx instanceof TransferTx && poolTx.data.amount.symbol === bal!.symbol) {
            if (poolTx.data.from.equals(tx.data.from)) {
              bal = bal!.sub(poolTx.data.amount);
            } else if (poolTx.data.to.equals(tx.data.from)) {
              bal = bal!.add(poolTx.data.amount);
            }
          }
        }
        const remaining = bal!.sub(tx.data.amount).sub(tx.data.fee);
        assert(remaining.amount.geq(0), 'not enough balance');
        await this.blockchain.indexer.addTx(txBuf, tx.data.expiration!.getTime());
        return this.txs.push(tx) - 1;
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
}
