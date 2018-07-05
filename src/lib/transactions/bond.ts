import * as ByteBuffer from 'bytebuffer';
import { Asset } from '../asset';
import { PublicKey } from '../crypto';
import {
  ObjectType,
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';

export interface Bond {
  minter: PublicKey; // Key that signs blocks
  staker: PublicKey; // Hot wallet that receives rewards and stakes its balance
  stake_amt: Asset;
}

export interface BondTxData extends TxData, Bond {
  type: TxType.BOND;
  bond_fee: Asset;
}

export class BondTx extends Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['minter', TS.publicKey],
    ['staker', TS.publicKey],
    ['stake_amt', TS.asset],
    ['bond_fee', TS.asset]
  ];
  static readonly SERIALIZER = TS.object(BondTx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(BondTx.SERIALIZER_FIELDS);

  static deserialize(buf: ByteBuffer, obj: any): any {
    return BondTx.DESERIALIZER(buf, obj);
  }

  constructor(readonly data: BondTxData) {
    super(data);
  }

  rawSerialize(buf: ByteBuffer): void {
    BondTx.SERIALIZER(buf, this.data);
  }
}
