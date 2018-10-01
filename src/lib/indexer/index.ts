import * as assert from 'assert';
import { Asset, PublicKey } from 'godcoin-neon';
import * as level from 'level';
import * as sodium from 'libsodium-wrappers';
import * as Long from 'long';

export * from './block_indexer';

export interface Bond {
  minter: PublicKey;
  staker: PublicKey;
  stake_amt: Asset;
}

export namespace IndexProp {
  export const NAMESPACE_MAIN = Buffer.from([0]);
  export const NAMESPACE_BLOCK = Buffer.from([1]);
  export const NAMESPACE_TX = Buffer.from([2]);
  export const NAMESPACE_BAL = Buffer.from([3]);
  export const NAMESPACE_BOND = Buffer.from([4]);

  /* Keys that belong in the main namespace */
  export const KEY_CURRENT_BLOCK_HEIGHT = Buffer.from('CURRENT_BLOCK_HEIGHT');
  export const KEY_TOKEN_SUPPLY = Buffer.from('TOKEN_SUPPLY');
}

export class Indexer {
  readonly db: any;

  constructor(dbPath) {
    this.db = level(dbPath, {
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    }, err => {
      /* istanbul ignore next */
      if (err) throw err;
    });
  }

  async init(): Promise<void> {
    await new Promise((resolve, reject) => {
      this.db.createReadStream({
        gte: IndexProp.NAMESPACE_TX,
        lt: Buffer.from([IndexProp.NAMESPACE_TX[0] + 1])
      }).on('data', data => {
        const key = data.key as Buffer;
        const value = data.value as Buffer;
        const expiry = value.readDoubleBE(0);
        assert(key.slice(0, IndexProp.NAMESPACE_TX.length).equals(IndexProp.NAMESPACE_TX));

        this.expireTxTimeout(key.slice(IndexProp.NAMESPACE_TX.length), expiry);
      }).on('end', () => {
        resolve();
      }).on('error', err => {
        console.log('Failed to prune the tx log', err);
        reject(err);
      });
    });
  }

  async close(): Promise<void> {
    await this.db.close();
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

  async getBond(minter: PublicKey): Promise<Bond|undefined> {
    const bondBuf: Buffer = await this.getProp(IndexProp.NAMESPACE_BOND, minter.buffer);
    if (!bondBuf) return;
    const staker = new PublicKey(bondBuf.slice(0, sodium.crypto_sign_PUBLICKEYBYTES));
    const amt = Asset.fromString(bondBuf.slice(sodium.crypto_sign_PUBLICKEYBYTES).toString('utf8'));
    return {
      minter,
      staker,
      stake_amt: amt
    };
  }

  async setBond(bond: Bond): Promise<void> {
    const amt = Buffer.from(bond.stake_amt.toString(), 'utf8');
    const val = Buffer.concat([bond.staker.buffer, amt]);
    await this.setProp(IndexProp.NAMESPACE_BOND, bond.minter.buffer, val);
  }

  async getBalance(key: PublicKey): Promise<[Asset, Asset]|undefined> {
    const bal = await this.getProp(IndexProp.NAMESPACE_BAL, key.buffer, {
      valueEncoding: 'json'
    });
    if (!bal) return;
    return [Asset.fromString(bal[0]), Asset.fromString(bal[1])];
  }

  async getBlockPos(height: number): Promise<Long|undefined> {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(height, 0, true);
    const pos: Buffer = await this.getProp(IndexProp.NAMESPACE_BLOCK, buf);
    if (!pos) return;
    const high = pos.readInt32BE(0, true);
    const low = pos.readInt32BE(4, true);
    return new Long(low, high, true);
  }

  async setBlockPos(height: number, bytePos: Long): Promise<void> {
    const key = Buffer.allocUnsafe(4);
    key.writeInt32BE(height, 0, true);

    const val = Buffer.allocUnsafe(8);
    val.writeInt32BE(bytePos.high, 0, true);
    val.writeInt32BE(bytePos.low, 4, true);
    await this.setProp(IndexProp.NAMESPACE_BLOCK, key, val);
  }

  async getChainHeight(): Promise<number|undefined> {
    const buf = await this.getProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_CURRENT_BLOCK_HEIGHT);
    if (!buf) return;
    return buf.readInt32BE(0, true);
  }

  async setChainHeight(height: number): Promise<void> {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(height, 0, true);
    await this.setProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_CURRENT_BLOCK_HEIGHT, buf);
  }

  async getTokenSupply(): Promise<[Asset, Asset]> {
    const bal = await this.getProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_TOKEN_SUPPLY, {
      valueEncoding: 'json'
    });
    if (!bal) return [Asset.EMPTY_GOLD, Asset.EMPTY_SILVER];
    return [Asset.fromString(bal[0]), Asset.fromString(bal[1])];
  }

  async setTokenSupply(supply: [Asset, Asset]): Promise<void> {
    await this.setProp(IndexProp.NAMESPACE_MAIN, IndexProp.KEY_TOKEN_SUPPLY, [
      supply[0].toString(),
      supply[1].toString()
    ], {
      valueEncoding: 'json'
    });
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
}
