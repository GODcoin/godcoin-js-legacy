import * as sodium from 'libsodium-wrappers';
import * as crypto from 'crypto';
import * as bs58 from 'bs58';

export const PUB_ADDRESS_PREFIX = 'GOD';
const PRIV_BUF_PREFIX = 0x01;
const PUB_BUF_PREFIX = 0x02;

export function doubleSha256(val: Buffer|string): Buffer {
  function sha256(val: Buffer|string): Buffer {
    return crypto.createHash('sha256').update(val).digest();
  }
  return sha256(sha256(val));
}

export class InvalidWif extends Error {

  constructor(msg?: string) {
    super(msg);
  }
}

export abstract class Key {

  constructor(readonly buffer: Buffer) {
  }

  abstract toWif(): string;

  equals(other: Key): boolean {
    return this.buffer.equals(other.buffer);
  }

  toString(): string {
    return this.toWif();
  }

  protected static keyFromWif(wif: string, prefix: number): Buffer {
    if (!wif) {
      throw new InvalidWif('wif not provided');
    }
    const raw = Buffer.from(bs58.decode(wif));
    if (raw[0] !== prefix) {
      throw new InvalidWif('invalid prefix');
    }
    const checksum = raw.slice(-4);
    let key = raw.slice(0, -4);
    if (!doubleSha256(key).slice(0, 4).equals(checksum)) {
      throw new InvalidWif('invalid checksum');
    }
    return key.slice(1);
  }
}

export class PrivateKey extends Key {

  get extended(): boolean { return !!this.seed; }

  constructor(buffer: Buffer, readonly seed?: Buffer) {
    super(buffer);
    if (buffer.length !== sodium.crypto_sign_SECRETKEYBYTES) {
      throw new InvalidWif(`invalid key length (got ${buffer.length} bytes)`);
    }
  }

  sign(buf: Buffer|ArrayBuffer): Buffer {
    return Buffer.from(sodium.crypto_sign_detached(buf, this.buffer));
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

  static fromWif(wif: string): KeyPair {
    let buf = Key.keyFromWif(wif, PRIV_BUF_PREFIX);
    if (buf.length === sodium.crypto_sign_SEEDBYTES) {
      const keys = sodium.crypto_sign_seed_keypair(buf);
      buf = Buffer.from(keys.privateKey)
      return {
        privateKey: new PrivateKey(buf, Buffer.from(keys.privateKey)),
        publicKey: new PublicKey(Buffer.from(keys.publicKey))
      };
    }

    const priv = new PrivateKey(buf, undefined);
    return {
      privateKey: priv,
      publicKey: priv.toPub()
    };
  }
}

export class PublicKey extends Key {

  constructor(buffer: Buffer) {
    super(buffer);
    if (buffer.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
      throw new InvalidWif(`invalid key length (got ${buffer.length} bytes)`);
    }
  }

  toWif(): string {
    const buf = Buffer.concat([Buffer.from([PUB_BUF_PREFIX]), this.buffer]);
    const checksum = doubleSha256(buf).slice(0, 4);
    const wif = Buffer.concat([buf, checksum]);
    return PUB_ADDRESS_PREFIX + bs58.encode(wif);
  }

  verify(signature: Buffer|ArrayBuffer, msg: Buffer|ArrayBuffer): boolean {
    return sodium.crypto_sign_verify_detached(signature, msg, this.buffer) === true;
  }

  static fromWif(wif: string): PublicKey {
    if (!(wif && wif.startsWith(PUB_ADDRESS_PREFIX))) {
      throw new InvalidWif('wif must start with ' + PUB_ADDRESS_PREFIX);
    }
    wif = wif.slice(PUB_ADDRESS_PREFIX.length);
    return new PublicKey(Key.keyFromWif(wif, PUB_BUF_PREFIX));
  }
}

export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export function generateKeyPair(): KeyPair {
  const seed = crypto.randomBytes(32);
  const keys = sodium.crypto_sign_seed_keypair(seed);
  return {
    privateKey: new PrivateKey(Buffer.from(keys.privateKey), seed),
    publicKey: new PublicKey(Buffer.from(keys.publicKey))
  };
}
