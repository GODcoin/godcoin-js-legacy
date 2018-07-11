import * as assert from 'assert';
import * as ByteBuffer from 'bytebuffer';
import * as newDebug from 'debug';
import { Asset } from '../asset';
import { GODcoin } from '../constants';
import { PublicKey, SigPair } from '../crypto';
import { Serializer } from './index';
import { ObjectType } from './object_type';

const debug = newDebug('godcoin:serializer');

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
      len = value.length;
    } else if (value instanceof ByteBuffer) {
      len = value.limit;
    }
    if (!len) return buf.writeUint32(0);
    else buf.writeUint32(len);
    buf.append(value);
  }

  static date(buf: ByteBuffer, value: Date) {
    buf.writeUint32(Math.floor(value.getTime() / 1000));
  }

  static publicKey(buf: ByteBuffer, value: PublicKey) {
    TypeSerializer.buffer(buf, value.buffer);
  }

  static sigPair(buf: ByteBuffer, value: SigPair) {
    TypeSerializer.publicKey(buf, value.public_key);
    TypeSerializer.buffer(buf, value.signature);
  }

  static asset(buf: ByteBuffer, value: Asset) {
    const str = value.toString();
    assert(str.length <= Asset.MAX_ASSET_STR_LEN);
    TypeSerializer.string(buf, str);
  }

  static object(fields: ObjectType[]): Serializer {
    return function object(buf: ByteBuffer, value: object) {
      for (const f of fields) {
        const key = f[0];
        const val = value[key];
        debug('serializing %s with %s', key, val);
        f[1](buf, val);
        /* istanbul ignore if  */
        if (debug.enabled) {
          buf.mark();
          debug('updated hex', buf.flip().toHex());
          buf.reset();
        }
      }
    };
  }

  static array(serializer: Serializer): Serializer {
    // tslint:disable-next-line:only-arrow-functions
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
