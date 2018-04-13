import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { Asset } from '../asset';
import * as assert from 'assert';

export interface TransferTxData extends TxData {
  type: TxType.TRANSFER;
  from: PublicKey;
  to: PublicKey;
  amount: Asset;
  fee: Asset;
  memo?: Buffer;
}

export class TransferTx extends Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['from', TS.publicKey],
    ['to', TS.publicKey],
    ['amount', TS.asset],
    ['fee', TS.asset],
    ['memo', TS.buffer]
  ];
  static readonly SERIALIZER = TS.object(TransferTx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(TransferTx.SERIALIZER_FIELDS);

  constructor(readonly data: TransferTxData) {
    super(data);
  }

  validate() {
    assert(this.data.signatures.length > 0, 'tx must have at least 1 signature');
    assert.equal(this.data.amount.symbol, this.data.fee.symbol, 'fee must be paid with the same asset');
    assert(this.data.fee.amount.gt(0), 'fee must be greater than zero');
    if (this.data.memo) {
      assert(this.data.memo.byteLength < 512, 'maximum memo length is 512 bytes');
    }
    const buf = this.serialize();
    const sig = this.data.signatures[0];
    assert(this.data.from.verify(sig, buf.toBuffer()), 'invalid signature');
  }

  rawSerialize(buf: ByteBuffer): void {
    TransferTx.SERIALIZER(buf, this.data);
  }

  static deserialize(buf: ByteBuffer): any {
    return TransferTx.DESERIALIZER(buf);
  }
}
