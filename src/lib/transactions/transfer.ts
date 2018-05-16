import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import * as bigInt from 'big-integer';
import { checkAsset } from './util';
import { Asset } from '../asset';
import * as assert from 'assert';

export interface TransferTxData extends TxData {
  type: TxType.TRANSFER;
  from: PublicKey;
  to: PublicKey;
  amount: Asset;
  memo?: Buffer;
}

export class TransferTx extends Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['from', TS.publicKey],
    ['to', TS.publicKey],
    ['amount', TS.asset],
    ['memo', TS.buffer]
  ];
  static readonly SERIALIZER = TS.object(TransferTx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(TransferTx.SERIALIZER_FIELDS);

  constructor(readonly data: TransferTxData) {
    super(data);
  }

  validate(): void {
    super.validate();
    assert.equal(this.data.amount.symbol, this.data.fee.symbol, 'fee must be paid with the same asset');
    assert(this.data.amount.amount.geq(0), 'amount must be greater than or equal to zero');
    checkAsset('amount', this.data.amount, this.data.fee.symbol);
    if (this.data.memo) {
      assert(this.data.memo.length <= 512, 'maximum memo length is 512 bytes');
    }
    const buf = this.serialize(false);
    const pair = this.data.signature_pairs[0];
    assert(this.data.from.verify(pair.signature, buf.toBuffer()), 'invalid signature');
  }

  rawSerialize(buf: ByteBuffer): void {
    TransferTx.SERIALIZER(buf, this.data);
  }

  static deserialize(buf: ByteBuffer, obj: any): any {
    return TransferTx.DESERIALIZER(buf, obj);
  }
}
