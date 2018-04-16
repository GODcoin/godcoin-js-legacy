import { Tx, TransferTx } from '../transactions';
import { Blockchain } from '../blockchain';
import { AssetSymbol, Asset } from '../asset';
import * as assert from 'assert';
import { Lock } from '../lock';

/**
 * Transaction pool as received by peers
 */
export class TxPool {

  private readonly lock = new Lock();
  private txs: Tx[] = [];

  constructor(readonly blockchain: Blockchain) {
  }

  async push(tx: Tx): Promise<number> {
    await this.lock.lock();
    try {
      tx.checkExpiry();
      if (tx instanceof TransferTx) {
        tx.validate();
        let bal: Asset|undefined;
        if (tx.data.amount.symbol === AssetSymbol.GOLD) {
          bal = await this.blockchain.getBalance(tx.data.from)[0];
        } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
          bal = await this.blockchain.getBalance(tx.data.from)[1];
        }
        assert(bal, 'unknown balance symbol ' + tx.data.amount.symbol);

        const remaining = bal!.sub(tx.data.amount).sub(tx.data.fee);
        assert(remaining.amount.geq(0), 'not enough balance');
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
