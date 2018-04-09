import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import * as newDebug from 'debug';
import { Asset } from '../asset';
import * as Long from 'long';

const debug = newDebug('godcoin:serializer');

export type Serializer = (buf: ByteBuffer, value: any) => void;
export type Deserializer = (buf: ByteBuffer) => any;

export interface ObjectType {
  0: string;
  1: Serializer;
}

export class TypeSerializer {

  static string(buf: ByteBuffer, value: string) {
    if (!value) {
      buf.writeUint32(0);
      return;
    }
    buf.writeUint32(Buffer.byteLength(value, 'utf8'));
    buf.writeUTF8String(value);
  }

  static uint8(buf: ByteBuffer, value: number) {
    buf.writeUint8(value);
  }

  static uint64(buf: ByteBuffer, value: number|Long) {
    buf.writeUint64(value);
  }

  static buffer(buf: ByteBuffer, value: Buffer|ByteBuffer) {
    let len = 0;
    if (value instanceof Buffer) {
      len = value.byteLength;
    } else if (value instanceof ByteBuffer) {
      len = value.limit;
    }
    if (!len) return buf.writeUint32(0);
    else buf.writeUint32(len);
    buf.append(value);
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
    TypeSerializer.buffer(buf, value.buffer);
  }

  static asset(buf: ByteBuffer, value: Asset|string) {
    if (typeof(value) === 'string') {
      value = Asset.fromString(value);
    }
    TypeSerializer.string(buf, value.toString());
  }

  static object(fields: ObjectType[]): Serializer {
    return function object(buf: ByteBuffer, value: object) {
      for (let i = 0; i < fields.length; ++i) {
        const key = fields[i][0];
        const val = value[key];
        debug('Serializing %s with %s', key, val);
        fields[i][1](buf, val);
        /* istanbul ignore if  */
        if (debug.enabled) {
          buf.mark();
          debug('Updated hex', buf.flip().toHex());
          buf.reset();
        }
      }
    };
  }

  static array(serializer: Serializer): Serializer {
    const array = function(buf: ByteBuffer, value: any[]) {
      buf.writeUint32(value.length);
      for (const val of value) {
        serializer(buf, val);
      }
    };
    (array as any).serializer = serializer;
    return array;
  }
}

export class TypeDeserializer {

  static string(buf: ByteBuffer): string|undefined {
    const len = buf.readUint32();
    if (len === 0) return;
    return buf.readUTF8String(len) as string;
  }

  static uint8(buf: ByteBuffer): number {
    return buf.readUint8();
  }

  static uint64(buf: ByteBuffer): Long {
    return buf.readUint64();
  }

  static buffer(buf: ByteBuffer): Buffer|undefined {
    const len = buf.readUint32();
    if (len === 0) return;
    return Buffer.from(buf.readBytes(len).toBuffer());
  }

  static date(buf: ByteBuffer): Date {
    return new Date(buf.readUint32() * 1000);
  }

  static publicKey(buf: ByteBuffer): PublicKey {
    const wif = TypeDeserializer.buffer(buf) as Buffer;
    return new PublicKey(wif);
  }

  static asset(buf: ByteBuffer): Asset {
    const asset = TypeDeserializer.string(buf) as string;
    return Asset.fromString(asset);
  }

  static object(fields: ObjectType[]): Deserializer {
    return (buf: ByteBuffer): any => {
      const data = {};
      for (let i = 0; i < fields.length; ++i) {
        const key = fields[i][0];
        const ds = fields[i][1].name;
        if (ds === 'array') {
          const s = (fields[i][1] as any).serializer;
          debug('Deserializing key %s (type: %s[%s])', key, ds, s.name);
          data[key] = TypeDeserializer.array(s)(buf);
        } else {
          debug('Deserializing key %s (type: %s)', key, ds);
          data[key] = TypeDeserializer[ds](buf);
        }
      }
      return data;
    };
  }

  static array(serializer: Serializer): Deserializer {
    return (buf: ByteBuffer): any[] => {
      const len = buf.readUint32();
      const array: any[] = [];
      for (let i = 0; i < len; ++i) {
        array.push(TypeDeserializer[serializer.name](buf));
      }
      return array;
    };
  }
}
