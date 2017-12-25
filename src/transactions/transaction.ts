import { TypeSerializer as TS } from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { PrivateKey } from '../crypto';
import * as assert from 'assert';
import * as newDebug from 'debug';

const debug = newDebug('godcoin:tx');

export enum TxType {
  TRANSFER = 0
}

export interface TxData {
  type: TxType;
  timestamp: Date;
  expiration: Date;
  signatures: string[];
}

export abstract class Tx {

  constructor(readonly tx: TxData) {
  }

  abstract validate();

  sign(key: PrivateKey) {
    const buf = this.serialize();
    if (debug.enabled) {
      debug('Signing TX\nTX: %o\nHex: %s', this, buf.toHex());
    }
    return key.sign(buf.toBuffer());
  }

  checkExpiry() {
    assert(this.tx.expiration.getTime() > Date.now(), 'tx expired');
  }

  serialize(): ByteBuffer {
    return this._serialize().flip();
  }

  protected _serialize(): ByteBuffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    TS.object([
      ['type', TS.uint8],
      ['timestamp', TS.date],
      ['expiration', TS.date]
    ])(buf, this.tx);
    return buf;
  }
}
