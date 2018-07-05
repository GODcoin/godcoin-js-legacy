import * as bs58 from 'bs58';
import { InvalidWif } from './invalid_wif';
import { doubleSha256 } from './util';

export abstract class Key {

  protected static keyFromWif(wif: string, prefix: number): Buffer {
    if (!wif) {
      throw new InvalidWif('wif not provided');
    }
    const raw = Buffer.from(bs58.decode(wif));
    if (raw[0] !== prefix) {
      throw new InvalidWif('invalid prefix');
    }
    const checksum = raw.slice(-4);
    const key = raw.slice(0, -4);
    if (!doubleSha256(key).slice(0, 4).equals(checksum)) {
      throw new InvalidWif('invalid checksum');
    }
    return key.slice(1);
  }

  constructor(readonly buffer: Buffer) {
  }

  abstract toWif(): string;

  equals(other: Key): boolean {
    return this.buffer.equals(other.buffer);
  }

  toString(): string {
    return this.toWif();
  }
}
