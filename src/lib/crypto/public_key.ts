import * as bs58 from 'bs58';
import * as sodium from 'libsodium-wrappers';
import { InvalidWif } from './invalid_wif';
import { Key } from './key';
import { doubleSha256 } from './util';

export const PUB_ADDRESS_PREFIX = 'GOD';
const PUB_BUF_PREFIX = 0x02;

export class PublicKey extends Key {

  static fromWif(wif: string): PublicKey {
    if (!(wif && wif.startsWith(PUB_ADDRESS_PREFIX))) {
      throw new InvalidWif('wif must start with ' + PUB_ADDRESS_PREFIX);
    }
    wif = wif.slice(PUB_ADDRESS_PREFIX.length);
    return new PublicKey(Key.keyFromWif(wif, PUB_BUF_PREFIX));
  }

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
}
