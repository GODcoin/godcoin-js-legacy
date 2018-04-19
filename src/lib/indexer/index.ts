import { PublicKey } from '../crypto';
import { Asset } from '../asset';
import * as assert from 'assert';
import * as level from 'level';
import * as Long from 'long';

const NAMESPACE_MAIN = Buffer.from([0]);
const NAMESPACE_BLOCK = Buffer.from([1]);
const NAMESPACE_TX = Buffer.from([2]);
const NAMESPACE_BAL = Buffer.from([3]);

const KEY_CURRENT_BLOCK_HEIGHT = Buffer.from('CURRENT_BLOCK_HEIGHT');

export class Indexer {
  private readonly db: any;

  constructor(dbPath) {
    this.db = level(dbPath, {
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    }, function (err) {
      /* istanbul ignore next */
      if (err) throw err;
    });
  }

  async init(): Promise<void> {
    this.db.createReadStream({
      gte: NAMESPACE_TX,
      lte: NAMESPACE_TX
    }).on('data', data => {
      const key = data.key as Buffer;
      const value = data.value as Buffer;
      const expiry = value.readUInt32BE(0);
      assert(key.slice(0, NAMESPACE_TX.length).equals(NAMESPACE_TX));

      this.expireTxTimeout(key.slice(NAMESPACE_TX.length), expiry);
    }).on('error', err => {
      console.log('Failed to prune the tx log', err);
    });
  }

  async getBalance(key: PublicKey): Promise<[Asset,Asset]|undefined> {
    const bal = this.getProp(NAMESPACE_BAL, key.buffer, {
      valueEncoding: 'json'
    });
    if (!bal) return;
    return [Asset.fromString(bal[0]), Asset.fromString(bal[1])];
  }

  async setBalance(key: PublicKey, gold: Asset, silver: Asset): Promise<void> {
    await this.setProp(NAMESPACE_BAL, key.buffer, [
      gold.toString(),
      silver.toString()
    ], {
      valueEncoding: 'json'
    });
  }

  async hasTx(txBuf: Buffer): Promise<boolean> {
    const tx = await this.getProp(NAMESPACE_TX, txBuf);
    return tx !== undefined;
  }

  async addTx(tx: Buffer, expiry: number): Promise<void> {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32BE(expiry, 0, true);
    await this.setProp(NAMESPACE_TX, tx, buf);
    this.expireTxTimeout(tx, expiry);
  }

  private expireTxTimeout(tx: Buffer, expiry: number) {
    setTimeout(async () => {
      try {
        await this.delProp(NAMESPACE_TX, tx);
      } catch (e) {
        console.log('Failed to prune TX', tx.toString('hex'), e);
      }
    }, expiry - Date.now()).unref();
  }

  async getBlockPos(height: Long): Promise<Long|undefined> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeInt32BE(height.high, 0, true);
    buf.writeInt32BE(height.low, 4, true);
    const pos: Buffer = await this.getProp(NAMESPACE_BLOCK, buf);
    if (!pos) return;
    const high = pos.readInt32BE(0, true);
    const low = pos.readInt32BE(4, true);
    return new Long(low, high, true);
  }

  async setBlockPos(height: Long, bytePos: Long): Promise<void> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeInt32BE(height.high, 0, true);
    buf.writeInt32BE(height.low, 4, true);

    const pos = Buffer.allocUnsafe(8);
    pos.writeInt32BE(bytePos.high, 0, true);
    pos.writeInt32BE(bytePos.low, 4, true);
    await this.setProp(NAMESPACE_BLOCK, buf, pos);
  }

  async getBlockHeight(): Promise<Long|undefined> {
    const buf = await this.getProp(NAMESPACE_MAIN, KEY_CURRENT_BLOCK_HEIGHT);
    if (!buf) return;
    const high = buf.readInt32BE(0, true);
    const low = buf.readInt32BE(4, true);
    return new Long(low, high, true);

  }

  async setBlockHeight(height: Long): Promise<void> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeInt32BE(height.high, 0, true);
    buf.writeInt32BE(height.low, 4, true);
    await this.setProp(NAMESPACE_MAIN, KEY_CURRENT_BLOCK_HEIGHT, buf);
  }

  private async getProp(ns: Buffer, prop: Buffer, opts?: any): Promise<any> {
    try {
      return await this.db.get(Buffer.concat([ns, prop]), opts);
    } catch (e) {
      if (!e.notFound) throw e;
    }
  }

  private async setProp(ns: Buffer,
                        prop: Buffer,
                        value: any,
                        opts?: any): Promise<void> {
    await this.db.put(Buffer.concat([ns, prop]), value, opts);
  }

  private async delProp(ns: Buffer, prop: Buffer): Promise<void> {
    await this.db.del(Buffer.concat([ns, prop]));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
