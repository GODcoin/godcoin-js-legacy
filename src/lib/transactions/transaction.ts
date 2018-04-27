import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { PrivateKey, PublicKey } from '../crypto';
import * as ByteBuffer from 'bytebuffer';
import * as newDebug from 'debug';
import { Asset } from '../asset';
import * as assert from 'assert';

const debug = newDebug('godcoin:tx');

export enum TxType {
  REWARD = 0,
  TRANSFER = 1
}

export interface TxData {
  type: TxType;
  timestamp: Date;
  fee: Asset;
  signatures: Buffer[];
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

  validate(): void {
    assert(this.data.timestamp.getTime() < Date.now(), 'timestamp cannot be in the future');
    assert(this.data.fee.amount.gt(0), 'fee must be greater than zero');
    assert(this.data.fee.decimals <= 8, 'fee can have a maximum of 8 decimals');
  }

  sign(key: PrivateKey): Buffer {
    const buf = this.serialize(false);
    if (debug.enabled) {
      debug('Signing TX\nTX: %o\nHex: %s', this, buf.toHex());
    }
    return key.sign(buf.toBuffer());
  }

  appendSign(key: PrivateKey) {
    const sig = this.sign(key);
    this.data.signatures.push(sig);
    return this;
  }

  checkExpiry(): void {
    const exp = this.data.timestamp.getTime();
    const now = Date.now();
    const delta = now - exp;
    assert(delta <= 60000, 'tx expired');
    assert(delta > 0, 'tx timestamp in the future');
  }

  serialize(includeSigs: boolean): ByteBuffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    if (includeSigs) {
      TS.array(TS.buffer)(buf, this.data.signatures);
    }
    Tx.SERIALIZER(buf, this.data);
    this.rawSerialize(buf);
    return buf.flip();
  }

  toString(): string {
    const data: any = {};
    Object.getOwnPropertyNames(this.data).forEach(name => {
      data[name] = Tx.stringify(this.data[name]);
    });
    return JSON.stringify(data, undefined, 2);
  }

  private static stringify(obj: any): any {
    if (obj instanceof Array) {
      const arr: any[] = [];
      for (const o of obj) arr.push(Tx.stringify(o));
      return arr;
    } else if (obj instanceof Buffer) {
      return obj.toString('hex');
    } else if (obj instanceof PublicKey) {
      return obj.toWif();
    }
    return obj;
  }
}
