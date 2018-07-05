import * as assert from 'assert';

export const enum AssetSymbol {
  GOLD = 'GOLD',
  SILVER = 'SILVER'
}

export class Asset {

  static fromString(str: string): Asset {
    assert(str.length <= 32, 'asset string is too big');
    const split = str.trim().split(' ');
    assert.strictEqual(split.length, 2, 'invalid asset format');
    assert(/^-?[0-9]*\.?[0-9]+\.?$/.test(split[0]), 'asset amount must be a valid number');
    assert(split[1] === AssetSymbol.GOLD || split[1] === AssetSymbol.SILVER,
            `asset type must be ${AssetSymbol.GOLD} or ${AssetSymbol.SILVER}`);

    const index = split[0].indexOf('.');
    let decimals = 0;
    if (index !== -1) {
      decimals = split[0].substring(index + 1).length;
      split[0] = split[0].replace('.', '');
    }

    const num = BigInt(split[0]);
    const symbol = split[1] as AssetSymbol;
    return new Asset(num, decimals, symbol);
  }

  constructor(readonly amount: BigInt,
              readonly decimals: number,
              readonly symbol: AssetSymbol) {}

  add(other: Asset): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t + o, decimals, this.symbol);
  }

  sub(other: Asset): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t - o, decimals, this.symbol);
  }

  mul(other: Asset, precision?: number): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    let decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);

    decimals *= 2;
    let mult = t * o;
    if (precision !== undefined) {
      mult = setDecimals(mult, decimals, precision);
      decimals = precision;
    }
    return new Asset(mult, decimals, this.symbol);
  }

  div(other: Asset, precision: number = 0): Asset {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');
    if (other.amount === BigInt(0)) throw new ArithmeticError('divide by zero');
    const decimals = Math.max(this.decimals, other.decimals, precision);
    const t = setDecimals(this.amount, this.decimals, decimals * 2);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return new Asset(t / o, decimals, this.symbol);
  }

  pow(num: number, precision: number = this.decimals): Asset {
    assert(typeof(num) === 'number', 'num must be of type number');
    assert((num % 1) === 0, 'num must be an integer');

    const dec = this.decimals * num;
    const pow = setDecimals(this.amount ** BigInt(num), dec, precision);
    return new Asset(pow, precision, this.symbol);
  }

  geq(other: Asset): boolean {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');

    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return t >= o;
  }

  gt(other: Asset): boolean {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');

    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return t > o;
  }

  lt(other: Asset): boolean {
    return !this.geq(other);
  }

  leq(other: Asset): boolean {
    return !this.gt(other);
  }

  eq(other: Asset) {
    assert.strictEqual(this.symbol, other.symbol, 'asset type mismatch');

    const decimals = Math.max(this.decimals, other.decimals);
    const t = setDecimals(this.amount, this.decimals, decimals);
    const o = setDecimals(other.amount, other.decimals, decimals);
    return t === o;
  }

  setDecimals(decimals: number) {
    assert(decimals >= 0, 'decimals must be 0 or greater');
    const num = setDecimals(this.amount, this.decimals, decimals);
    return new Asset(num, decimals, this.symbol);
  }

  toString(): string {
    let amount = this.amount.toString();
    const negative = this.amount < 0;
    if (negative) amount = amount.substring(1);
    const full = amount.substring(0, amount.length - this.decimals);
    let partial = '';
    if (this.decimals > 0) {
      const num = amount.substring(amount.length - this.decimals);
      partial = (full ? '.' : '0.') + '0'.repeat(this.decimals - num.length) + num;
    }
    return `${negative ? '-' : ''}${full}${partial} ${this.symbol}`;
  }
}

export const EMPTY_GOLD = new Asset(BigInt(0), 0, AssetSymbol.GOLD);
export const EMPTY_SILVER = new Asset(BigInt(0), 0, AssetSymbol.SILVER);

export class ArithmeticError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

function setDecimals(old: BigInt,
                     oldDecimals: number,
                     newDecimals: number): BigInt {
  if (newDecimals > oldDecimals) {
    return old * BigInt('1' + '0'.repeat(newDecimals - oldDecimals));
  } else if (newDecimals < oldDecimals) {
    return old / BigInt('1' + '0'.repeat(oldDecimals - newDecimals));
  }
  return old;
}
