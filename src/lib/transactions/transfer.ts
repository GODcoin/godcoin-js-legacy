import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { Asset } from '../asset';

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

  rawSerialize(buf: ByteBuffer): void {
    TransferTx.SERIALIZER(buf, this.data);
  }

  static deserialize(buf: ByteBuffer, obj: any): any {
    return TransferTx.DESERIALIZER(buf, obj);
  }
}
