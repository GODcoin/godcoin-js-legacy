import { Asset, AssetSymbol } from '../asset';
import { GODcoin } from '../constants';
import * as assert from 'assert';

export function checkAsset(name: string, amt: Asset, symbol?: AssetSymbol) {
  if (symbol) assert(amt.symbol === symbol, `${name} must be in ${symbol}`);
  assert(amt.decimals <= GODcoin.MAX_PRECISION, `${name} can have a maximum of ${GODcoin.MAX_PRECISION} decimals`);
}
