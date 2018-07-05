import * as assert from 'assert';
import * as newDebug from 'debug';
import { Asset } from '../asset';
import { GODcoin } from '../constants';
import { PublicKey, SigPair } from '../crypto';
import { Deserializer, ObjectDeserializer, Serializer } from './index';
import { ObjectType } from './object_type';

const debug = newDebug('godcoin:serializer');

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

  static sigPair(buf: ByteBuffer): SigPair {
    const publicKey = TypeDeserializer.publicKey(buf);
    const signature = TypeDeserializer.buffer(buf)!;
    return {
      public_key: publicKey,
      signature
    };
  }

  static asset(buf: ByteBuffer): Asset {
    const asset = TypeDeserializer.string(buf) as string;
    assert(asset.length <= GODcoin.MAX_ASSET_STR_LEN, 'asset string is too large');
    return Asset.fromString(asset);
  }

  static object(fields: ObjectType[]): ObjectDeserializer {
    return (buf: ByteBuffer, obj?: any): any => {
      const data = obj ? obj : {};
      for (const f of fields) {
        const key = f[0];
        const ds = f[1].name;
        if (ds === 'array') {
          const s = (f[1] as any).serializer;
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
