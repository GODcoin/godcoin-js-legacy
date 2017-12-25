import { BigInteger } from 'big-integer';
import * as bigInt from 'big-integer';
import * as assert from 'assert';

export const enum AssetSymbol {
  GOLD = 'GOLD',
  SILVER = 'SILVER'
}

export class Asset {

  constructor(readonly amount: BigInteger,
              readonly decimals: number,
              readonly symbol: AssetSymbol) {}

  add(other: Asset): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t.add(o), decimals, this.symbol);
  }

  sub(other: Asset): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t.subtract(o), decimals, this.symbol);
  }

  mul(other: Asset): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t.multiply(o), decimals * 2, this.symbol);
  }

  div(other: Asset, precision: number = 0): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    if (other.amount.eq(0)) throw new ArithmeticError('divide by zero');
    const decimals = Math.max(this.decimals, other.decimals, precision);
    const t = setDecimals(this.amount, this.decimals, decimals * 2);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t.divide(o), decimals, this.symbol);
  }

  toString(): string {
    const amount = this.amount.toString();
    const full = amount.substring(0, amount.length - this.decimals);
    const partial = this.decimals > 0
                      ? '.' + amount.substring(amount.length - this.decimals)
                      : '';
    return `${full}${partial} ${this.symbol}`;
  }

  static fromString(asset: string): Asset {
    const split = asset.trim().split(' ');
    assert.strictEqual(split.length, 2, 'invalid asset format');
    assert(split[0].length <= 25, 'asset amount is too big');
    assert(/^-?[0-9]*\.?[0-9]+\.?$/.test(split[0]), 'asset amount must be a valid number');
    assert(split[1] === AssetSymbol.GOLD || split[1] === AssetSymbol.SILVER,
            `asset type must be ${AssetSymbol.GOLD} or ${AssetSymbol.SILVER}`);

    const index = split[0].indexOf('.');
    let decimals = 0;
    if (index !== -1) {
      decimals = split[0].substring(index + 1).length;
      split[0] = split[0].replace('.', '');
    }

    const num = bigInt(split[0]);
    const symbol = split[1] as AssetSymbol;
    return new Asset(num, decimals, symbol);
  }
}

export class ArithmeticError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

function setDecimals(old: BigInteger,
                      oldDecimals: number,
                      newDecimals: number): BigInteger {
  if (newDecimals > oldDecimals) {
    return old.multiply('1' + '0'.repeat(newDecimals - oldDecimals));
  } else if (oldDecimals < newDecimals) {
    return old.divide('1' + '0'.repeat(newDecimals - oldDecimals));
  }
  return old;
}
