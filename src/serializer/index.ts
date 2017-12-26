import { PublicKey } from '../crypto';
import * as newDebug from 'debug';
import { Asset } from '../asset';

const debug = newDebug('godcoin:serializer');

export type Serializer = (buf: ByteBuffer, value: any) => void;

export interface ObjectType {
  0: string;
  1: Serializer;
}

export class TypeSerializer {

  static string(buf: ByteBuffer, value: string) {
    if (!value) {
      return;
    }
    buf.writeUint32(value.length);
    buf.writeUTF8String(value);
  }

  static uint8(buf: ByteBuffer, value: number) {
    buf.writeUint8(value);
  }

  static uint64(buf: ByteBuffer, value: Long) {
    buf.writeUint64(value);
  }

  static date(buf: ByteBuffer, value: Date|string) {
    if (typeof(value) === 'string') {
      value = new Date(value);
    }
    buf.writeUint32(Math.floor(value.getTime() / 1000));
  }

  static publicKey(buf: ByteBuffer, value: PublicKey|string) {
    if (typeof(value) === 'string') {
      value = PublicKey.fromWif(value);
    }
    TypeSerializer.string(buf, value.toWif());
  }

  static asset(buf: ByteBuffer, value: Asset|string) {
    if (typeof(value) === 'string') {
      value = Asset.fromString(value);
    }
    TypeSerializer.string(buf, value.amount.toString());
    TypeSerializer.string(buf, value.symbol.toString());
  }

  static object(fields: ObjectType[]): Serializer {
    return (buf: ByteBuffer, value: object) => {
      for (let i = 0; i < fields.length; ++i) {
        const key = fields[i][0];
        const val = value[key];
        debug('Serializing %s with %s', key, val);
        fields[i][1](buf, val);
        if (debug.enabled) {
          const offset = buf.offset;
          debug('Updated hex', buf.flip().toHex());
          buf.offset = offset;
        }
      }
    };
  }

  static array(serializer: Serializer): Serializer {
    return (buf: ByteBuffer, value: any[]) => {
      buf.writeUint32(value.length);
      for (const val of value) {
        serializer(buf, val);
      }
    };
  }
}
