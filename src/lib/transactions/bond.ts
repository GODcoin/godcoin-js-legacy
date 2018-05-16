import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { Tx, TxData, TxType } from './transaction';
import { Asset, AssetSymbol } from '../asset';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import * as bigInt from 'big-integer';
import { checkAsset } from './util';
import * as assert from 'assert';

export interface BondTxData extends TxData {
  type: TxType.BOND;
  minter: PublicKey; // Key that signs blocks
  staker: PublicKey; // Hot wallet that receives rewards and stakes its balance
  stake_amt: Asset;
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

  constructor(readonly data: BondTxData) {
    super(data);
  }

  validate(): void {
    super.validate();
    const data = this.data;
    checkAsset('stake_amt', data.stake_amt, AssetSymbol.GOLD);
    checkAsset('bond_fee', data.bond_fee, AssetSymbol.GOLD);

    const buf = this.serialize(false);

    assert(this.data.signature_pairs.length === 2, 'transaction must be signed by the minter and staker');
    const minter = this.data.signature_pairs[0];
    assert(this.data.minter.verify(minter.signature, buf.toBuffer()), 'invalid signature');

    const staker = this.data.signature_pairs[1];
    assert(this.data.staker.verify(staker.signature, buf.toBuffer()), 'invalid signature');
  }

  rawSerialize(buf: ByteBuffer): void {
    BondTx.SERIALIZER(buf, this.data);
  }

  static deserialize(buf: ByteBuffer, obj: any): any {
    return BondTx.DESERIALIZER(buf, obj);
  }
}
