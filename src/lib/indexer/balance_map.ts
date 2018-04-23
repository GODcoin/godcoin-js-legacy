import { PublicKey } from '../crypto';
import { Asset } from '../asset';

export type CacheMissCallback = (key: PublicKey) => Promise<[Asset,Asset]>;
export type AssetMap = { [acc: string]: [Asset,Asset] };

export class BalanceMap {

  private map: AssetMap = {};

  private _count = 0;
  get count() { return this._count; }

  constructor(readonly cacheMiss: CacheMissCallback) {
  }

  async getBal(key: PublicKey): Promise<[Asset, Asset]> {
    const hex = key.buffer.toString('hex');
    let cache = this.map[hex];
    if (!cache) {
      cache = this.map[hex] = await this.cacheMiss(key);
      ++this._count;
    }
    return cache;
  }

  flush(): AssetMap {
    const map = this.map;
    this.map = {};
    this._count = 0;
    return map;
  }
}
