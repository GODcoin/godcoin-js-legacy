import { Asset, AssetSymbol } from '../asset';
import * as assert from 'assert';

export const MAX_DECIMALS = 8;

export function checkAsset(name: string, amt: Asset, symbol?: AssetSymbol) {
  if (symbol) assert(amt.symbol === symbol, `${name} must be in ${symbol}`);
  assert(amt.decimals <= MAX_DECIMALS, `${name} can have a maximum of 8 decimals`);
}
