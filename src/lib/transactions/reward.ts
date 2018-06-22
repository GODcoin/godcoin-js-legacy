import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { Asset } from '../asset';

export interface RewardTxData extends TxData {
  type: TxType.REWARD;
  to: PublicKey;
  rewards: Asset[];
}

export class RewardTx extends Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['to', TS.publicKey],
    ['rewards', TS.array(TS.asset)]
  ];
  static readonly SERIALIZER = TS.object(RewardTx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(RewardTx.SERIALIZER_FIELDS);

  constructor(readonly data: RewardTxData) {
    super(data);
  }

  rawSerialize(buf: ByteBuffer): void {
    RewardTx.SERIALIZER(buf, this.data);
  }

  static deserialize(buf: ByteBuffer, obj: any): any {
    return RewardTx.DESERIALIZER(buf, obj);
  }
}
