import * as sodium from 'libsodium-wrappers';
import * as crypto from 'crypto';
import * as assert from 'assert';
import * as level from 'level';

export class WalletDb {

  private readonly db: any;
  private password!: Buffer;

  constructor(dbPath: string, cb: (err?: any) => void) {
    this.db = level(dbPath, function (err, db) {
      /* istanbul ignore next */
      if (err) return cb(err);
      cb();
    });
  }

  setPassword(pw: string) {
    assert(!this.password, 'password is already set');
    this.password = crypto.createHash('sha256').update(pw).digest();
  }

  lock() {
    this.password = undefined as any;
  }

  async isLocked(): Promise<boolean> {
    try {
      await this.db.get(WalletIndexProp.INITIALIZED);
      return true;
    } catch (e) {
      if (!e.notFound) throw e;
      return false;
    }
  }

  async getProp(prop: WalletIndexProp): Promise<any> {
    const value = await this.db.get(prop);
    assert(this.password, 'wallet not unlocked');
    const cipherText = Buffer.from(value, 'base64');
    const nonce = cipherText.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const enc = cipherText.slice(sodium.crypto_secretbox_NONCEBYTES);
    const dec = sodium.crypto_secretbox_open_easy(enc, nonce, this.password);
    return Buffer.from(dec).toString();
  }

  async setProp(prop: WalletIndexProp, value: string): Promise<void> {
    assert(this.password, 'wallet not unlocked');
    const msg = Buffer.from(value);
    const nonce = crypto.randomBytes(sodium.crypto_secretbox_NONCEBYTES);
    const enc = sodium.crypto_secretbox_easy(msg, nonce, this.password);
    const final = Buffer.concat([nonce, enc]);
    await this.db.put(prop, final.toString('base64'));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export enum WalletIndexProp {
  INITIALIZED = 'INITIALIZED'
}
