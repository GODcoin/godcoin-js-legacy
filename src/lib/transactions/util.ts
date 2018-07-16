import * as assert from 'assert';
import { Asset, AssetSymbol } from '../asset';

export function checkAsset(name: string, amt: Asset, symbol?: AssetSymbol) {
  if (symbol) assert(amt.symbol === symbol, `${name} must be in ${symbol}`);
  assert(amt.decimals <= Asset.MAX_PRECISION, `${name} can have a maximum of ${Asset.MAX_PRECISION} decimals`);
}

export function addBalAgnostic(bal: [Asset, Asset], asset: Asset) {
  if (asset.symbol === AssetSymbol.GOLD) {
    bal[0] = bal[0].add(asset);
  } else if (asset.symbol === AssetSymbol.SILVER) {
    bal[1] = bal[1].add(asset);
  } else {
    throw new Error('unhandled symbol: ' + asset.symbol);
  }
}

export function subBalAgnostic(bal: [Asset, Asset], asset: Asset) {
  if (asset.symbol === AssetSymbol.GOLD) {
    bal[0] = bal[0].sub(asset);
  } else if (asset.symbol === AssetSymbol.SILVER) {
    bal[1] = bal[1].sub(asset);
  } else {
    throw new Error('unhandled symbol: ' + asset.symbol);
  }
}
