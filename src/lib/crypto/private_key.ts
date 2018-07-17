import * as bs58 from 'bs58';
import * as sodium from 'libsodium-wrappers';
import { SigPair } from '.';
import { KeyPair } from '.';
import { InvalidWif } from './invalid_wif';
import { Key } from './key';
import { PublicKey } from './public_key';
import { doubleSha256 } from './util';

const PRIV_BUF_PREFIX = 0x01;

export class PrivateKey extends Key {

  static fromWif(wif: string): KeyPair {
    const buf = Key.keyFromWif(wif, PRIV_BUF_PREFIX);
    if (buf.length === sodium.crypto_sign_SEEDBYTES) {
      const keys = sodium.crypto_sign_seed_keypair(buf);
      return {
        privateKey: new PrivateKey(Buffer.from(keys.privateKey), buf),
        publicKey: new PublicKey(Buffer.from(keys.publicKey))
      };
    }

    const priv = new PrivateKey(buf, undefined);
    return {
      privateKey: priv,
      publicKey: priv.toPub()
    };
  }

  get extended(): boolean { return !!this.seed; }

  constructor(buffer: Buffer, readonly seed?: Buffer) {
    super(buffer);
    if (buffer.length !== sodium.crypto_sign_SECRETKEYBYTES) {
      throw new InvalidWif(`invalid key length (got ${buffer.length} bytes)`);
    } else if (seed && seed.length !== sodium.crypto_sign_SEEDBYTES) {
      throw new InvalidWif(`invalid seed length (got ${seed.length} bytes)`);
    }
  }

  sign(buf: Buffer|ArrayBuffer): SigPair {
    return {
      public_key: this.toPub(),
      signature: Buffer.from(sodium.crypto_sign_detached(buf, this.buffer))
    };
  }

  toWif(extended = false): string {
    if (!(extended || this.seed)) {
      throw new InvalidWif('cannot created compressed wif without seed');
    }
    const internalBuf = extended ? this.buffer : this.buffer.slice(0, 32);
    const buf = Buffer.concat([Buffer.from([PRIV_BUF_PREFIX]), internalBuf]);
    const checksum = doubleSha256(buf).slice(0, 4);
    const wif = Buffer.concat([buf, checksum]);
    return bs58.encode(wif);
  }

  toPub(): PublicKey {
    const start = sodium.crypto_sign_SEEDBYTES;
    const end = sodium.crypto_sign_PUBLICKEYBYTES;
    return new PublicKey(this.buffer.slice(start, start + end));
  }
}
