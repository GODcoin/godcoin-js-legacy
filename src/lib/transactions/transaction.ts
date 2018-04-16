import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { PrivateKey } from '../crypto';
import * as newDebug from 'debug';
import * as assert from 'assert';

const debug = newDebug('godcoin:tx');

export enum TxType {
  REWARD = 0,
  TRANSFER = 1
}

export interface TxData {
  type: TxType;
  timestamp: Date;
  expiration?: Date;
  signatures: Buffer[];
}

export abstract class Tx {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['type', TS.uint8],
    ['timestamp', TS.date]
  ];
  static readonly SERIALIZER = TS.object(Tx.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(Tx.SERIALIZER_FIELDS);

  constructor(readonly data: TxData) {
    const truncated = Math.floor(data.timestamp.getTime() / 1000) * 1000;
    this.data.timestamp = new Date(truncated);
  }

  abstract validate(): ByteBuffer;
  abstract rawSerialize(buf: ByteBuffer): void;

  sign(key: PrivateKey): Buffer {
    const buf = this.serialize();
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
    const exp = this.data.expiration;
    assert(exp, 'missing tx expiry');
    const time = exp!.getTime();
    const now = Date.now();
    assert(time > now, 'tx expired or missing');
    assert(time - now <= 60000, 'tx expiry too far into the future');
  }

  serialize(includeSigs = false): ByteBuffer {
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
    Object.getOwnPropertyNames(this).forEach(name => {
      data[name] = this[name];
    });
    return JSON.stringify(data, undefined, 2);
  }
}
