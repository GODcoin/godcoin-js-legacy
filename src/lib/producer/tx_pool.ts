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

  constructor(readonly blockchain: Blockchain,
              readonly writable: boolean) {
    super();
    this.indexer = this.blockchain.indexer;
  }

  async push(txBuf: Buffer, nodeOrigin?: string): Promise<[Long, number]> {
    assert(this.writable, 'pool is read only');
    await this.lock.lock();
    try {
      assert(!(await this.indexer.hasTx(txBuf)), 'duplicate tx');
      const tx = deserialize<Tx>(ByteBuffer.wrap(txBuf));
      { // Validate time
        tx.checkExpiry();
        const timeTx = tx.data.timestamp.getTime();
        const timeHead = this.blockchain.head.timestamp.getTime() - 3000;
        assert(timeTx > timeHead, 'timestamp cannot be behind 3 seconds of the block head time');
      }
      tx.validate();

      if (tx instanceof TransferTx) {
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
      } else if (tx instanceof BondTx) {
        // TODO: handle stake amount modifications
        const bal = (await this.blockchain.getBalance(tx.data.staker, this.txs))[0];
        const fee = (await this.blockchain.getTotalFee(tx.data.staker, this.txs))[0];
        assert(tx.data.fee.geq(fee), 'fee amount too small, expected ' + fee.toString());

        assert(tx.data.bond_fee.eq(GODcoin.BOND_FEE), 'invalid bond_fee');
        const remaining = bal.sub(fee).sub(tx.data.bond_fee).sub(tx.data.stake_amt);
        assert(remaining.amount.geq(0), 'insufficient balance');
      } else {
        throw new Error('invalid transaction');
      }

      await this.indexer.addTx(txBuf, tx.data.timestamp!.getTime() + 60000);
      this.emit('tx', tx, nodeOrigin);
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
