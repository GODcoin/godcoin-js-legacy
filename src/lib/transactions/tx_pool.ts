import { Tx } from './transaction';

export class TxPool {

  private pool: undefined|Tx[];

  addTx(tx: Tx): void {
    if (!this.pool) {
      this.pool = [];
    }
    this.pool.push(tx);
  }

  getAll(): undefined|Tx[] {
    return this.pool;
  }

  popAll(): undefined|Tx[] {
    const tmp = this.pool;
    this.pool = undefined;
    return tmp;
  }
}
