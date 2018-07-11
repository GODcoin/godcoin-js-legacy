import * as assert from 'assert';
import { Asset, AssetSymbol } from '../asset';

export function checkAsset(name: string, amt: Asset, symbol?: AssetSymbol) {
  if (symbol) assert(amt.symbol === symbol, `${name} must be in ${symbol}`);
  assert(amt.decimals <= Asset.MAX_PRECISION, `${name} can have a maximum of ${Asset.MAX_PRECISION} decimals`);
}
