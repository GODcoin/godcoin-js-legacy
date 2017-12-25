import * as sodium from 'libsodium-wrappers';
import * as crypto from 'crypto';
import * as bs58 from 'bs58';

export const PUB_ADDRESS_PREFIX = 'GOD';
const BUF_PREFIX = 0x80;

export function sha256(val: Buffer|string): Buffer {
  return crypto.createHash('sha256').update(val).digest();
}

export class InvalidWif extends Error {

  constructor(msg?: string) {
    super(msg);
  }
}

class Key {
  readonly buffer: Buffer;

  constructor(buffer: Buffer|Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.buffer = Buffer.from(buffer as any);
    } else {
      this.buffer = buffer;
    }
  }

  toWif(): string {
    const buf = Buffer.concat([Buffer.from([BUF_PREFIX]), this.buffer]);
    const checksum = sha256(sha256(buf)).slice(0, 4);
    const wif = Buffer.concat([buf, checksum]);
    return bs58.encode(wif);
  }

  toString(): string {
    return this.toWif();
  }

  protected static keyFromWif(wif: string): Buffer {
    if (!wif) {
      throw new InvalidWif('wif not provided');
    }
    const raw = Buffer.from(bs58.decode(wif));
    if (raw[0] !== BUF_PREFIX) {
      throw new InvalidWif('invalid prefix');
    }
    const checksum = raw.slice(-4);
    const key = raw.slice(0, -4);
    if (!sha256(sha256(key)).slice(0, 4).equals(checksum)) {
      throw new InvalidWif('invalid checksum');
    }
    return key.slice(1);
  }
}

export class PrivateKey extends Key {

  constructor(buffer: Buffer|Uint8Array) {
    super(buffer);
  }

  sign(buf: Buffer|ArrayBuffer): Buffer {
    return Buffer.from(sodium.crypto_sign_detached(buf, this.buffer));
  }

  static fromWif(wif: string): PrivateKey {
    return new PrivateKey(Key.keyFromWif(wif));
  }
}

export class PublicKey extends Key {

  constructor(buffer: Buffer|Uint8Array) {
    super(buffer);
  }

  toWif(): string {
    const wif = super.toWif();
    return PUB_ADDRESS_PREFIX + wif;
  }

  verify(signature: Buffer|ArrayBuffer, msg: Buffer|ArrayBuffer): boolean {
    return sodium.crypto_sign_verify_detached(signature, msg, this.buffer);
  }

  static fromWif(wif: string): PublicKey {
    if (!(wif && wif.startsWith(PUB_ADDRESS_PREFIX))) {
      throw new InvalidWif('wif must start with ' + PUB_ADDRESS_PREFIX);
    }
    wif = wif.slice(PUB_ADDRESS_PREFIX.length);
    return new PublicKey(Key.keyFromWif(wif));
  }
}

export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export function generateKeyPair(): KeyPair {
  const keys = sodium.crypto_sign_keypair();
  return {
    privateKey: new PrivateKey(keys.privateKey),
    publicKey: new PublicKey(keys.publicKey)
  };
}
