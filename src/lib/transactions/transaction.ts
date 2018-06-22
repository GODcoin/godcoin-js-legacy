import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { PrivateKey, PublicKey, SigPair } from '../crypto';
import * as ByteBuffer from 'bytebuffer';
import * as newDebug from 'debug';
import { Asset } from '../asset';

const debug = newDebug('godcoin:tx');

export enum TxType {
  REWARD = 0,
  TRANSFER = 1,
  BOND = 2
}

export interface TxData {
  type: TxType;
  timestamp: Date;
  fee: Asset;
  signature_pairs: SigPair[];
}

export abstract class Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['type', TS.uint8],
    ['timestamp', TS.date],
    ['fee', TS.asset]
  ];
  static readonly SERIALIZER = TS.object(Tx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(Tx.SERIALIZER_FIELDS);

  constructor(readonly data: TxData) {
    const truncated = Math.floor(data.timestamp.getTime() / 1000) * 1000;
    this.data.timestamp = new Date(truncated);
  }

  abstract rawSerialize(buf: ByteBuffer): void;

  sign(key: PrivateKey): SigPair {
    const buf = this.serialize(false);
    /* istanbul ignore if */
    if (debug.enabled) debug('Signing TX\nTX: %o\nHex: %s', this, buf.toHex());
    return key.sign(buf.toBuffer());
  }

  appendSign(key: PrivateKey) {
    const sig = this.sign(key);
    this.data.signature_pairs.push(sig);
    return this;
  }

  serialize(includeSigs: boolean): ByteBuffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    if (includeSigs) TS.array(TS.sigPair)(buf, this.data.signature_pairs);
    Tx.SERIALIZER(buf, this.data);
    this.rawSerialize(buf);
    return buf.flip();
  }

  toString(): string {
    const data: any = {};
    Object.getOwnPropertyNames(this.data).forEach(name => {
      if (name === 'type') {
        data[name] = TxType[this.data[name]];
      } else {
        data[name] = Tx.stringify(this.data[name]);
      }
    });
    return JSON.stringify(data, undefined, 2);
  }

  private static stringify(obj: any): any {
    if (obj instanceof Array) {
      const arr: any[] = [];
      for (const o of obj) arr.push(Tx.stringify(o));
      return arr;
    } else if (obj instanceof Asset) {
      return obj.toString();
    } else if (obj instanceof Buffer) {
      return obj.toString('hex');
    } else if (obj instanceof PublicKey) {
      return obj.toWif();
    } else if (obj && obj.public_key && obj.signature) {
      return {
        public_key: obj.public_key.toWif(),
        signature: obj.signature.toString('hex')
      };
    }
    return obj;
  }
}
