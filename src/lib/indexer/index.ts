import { PublicKey } from '../crypto';
import { Asset } from '../asset';
import * as assert from 'assert';
import * as level from 'level';
import * as Long from 'long';

export * from './batch';

export namespace IndexProp {
  export const NAMESPACE_MAIN = Buffer.from([0]);
  export const NAMESPACE_BLOCK = Buffer.from([1]);
  export const NAMESPACE_TX = Buffer.from([2]);
  export const NAMESPACE_BAL = Buffer.from([3]);

  export const KEY_CURRENT_BLOCK_HEIGHT = Buffer.from('CURRENT_BLOCK_HEIGHT');
}

export class Indexer {
  readonly db: any;

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
      gte: IndexProp.NAMESPACE_TX,
      lte: IndexProp.NAMESPACE_TX
    }).on('data', data => {
      const key = data.key as Buffer;
      const value = data.value as Buffer;
      const expiry = value.readDoubleBE(0);
      assert(key.slice(0, IndexProp.NAMESPACE_TX.length).equals(IndexProp.NAMESPACE_TX));

      this.expireTxTimeout(key.slice(IndexProp.NAMESPACE_TX.length), expiry);
    }).on('error', err => {
      console.log('Failed to prune the tx log', err);
    });
  }

  async getBalance(key: PublicKey): Promise<[Asset,Asset]|undefined> {
    const bal = await this.getProp(IndexProp.NAMESPACE_BAL, key.buffer, {
      valueEncoding: 'json'
    });
    if (!bal) return;
    return [Asset.fromString(bal[0]), Asset.fromString(bal[1])];
  }

  async hasTx(txBuf: Buffer): Promise<boolean> {
    const tx = await this.getProp(IndexProp.NAMESPACE_TX, txBuf);
    return tx !== undefined;
  }

  async addTx(tx: Buffer, expiry: number): Promise<void> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(expiry, 0, true);
    await this.setProp(IndexProp.NAMESPACE_TX, tx, buf);
    this.expireTxTimeout(tx, expiry);
  }

  private expireTxTimeout(tx: Buffer, expiry: number) {
    setTimeout(async () => {
      try {
        await this.delProp(IndexProp.NAMESPACE_TX, tx);
      } catch (e) {
        console.log('Failed to prune TX', tx.toString('hex'), e);
      }
    }, expiry - Date.now()).unref();
  }

  async getBlockPos(height: Long): Promise<Long|undefined> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeInt32BE(height.high, 0, true);
    buf.writeInt32BE(height.low, 4, true);
    const pos: Buffer = await this.getProp(IndexProp.NAMESPACE_BLOCK, buf);
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
    await this.setProp(IndexProp.NAMESPACE_BLOCK, buf, pos);
  }

  async getChainHeight(): Promise<Long|undefined> {
    const buf = await this.getProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_CURRENT_BLOCK_HEIGHT);
    if (!buf) return;
    const high = buf.readInt32BE(0, true);
    const low = buf.readInt32BE(4, true);
    return new Long(low, high, true);

  }

  async setChainHeight(height: Long): Promise<void> {
    const buf = Buffer.allocUnsafe(8);
    buf.writeInt32BE(height.high, 0, true);
    buf.writeInt32BE(height.low, 4, true);
    await this.setProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_CURRENT_BLOCK_HEIGHT, buf);
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
