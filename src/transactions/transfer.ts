import { TypeSerializer as TS } from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import { PublicKey } from '../crypto';
import { Asset } from '../asset';
import * as assert from 'assert';

export interface TransferTxData extends TxData {
  type: TxType.TRANSFER;
  from: PublicKey;
  to: PublicKey;
  amount: Asset;
  fee: Asset;
}

export class TransferTx extends Tx {

  constructor(readonly tx: TransferTxData) {
    super(tx);
  }

  validate() {
    assert(this.tx.signatures.length > 0, 'tx must have at least 1 signature');
    assert.equal(this.tx.amount.symbol, this.tx.fee.symbol, 'fee must be paid with the same asset');
    const buf = this.serialize();
    const sig = Buffer.from(this.tx.signatures[0], 'hex');
    assert(this.tx.from.verify(sig, buf.toBuffer()), 'signature is invalid');
  }

  protected _serialize(): ByteBuffer {
    const buf = super._serialize();
    TS.object([
      ['from', TS.publicKey],
      ['to', TS.publicKey],
      ['amount', TS.asset],
      ['memo', TS.string]
    ])(buf, this.tx);
    return buf;
  }
}
