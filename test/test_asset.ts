import {
  ArithmeticError,
  AssetSymbol,
  Asset
} from '../src/lib/asset';
import { AssertionError } from 'assert';
import { expect } from 'chai';

it('should parse valid input', () => {
  function check(asset: Asset,
                  amount: string,
                  decimals: number,
                  symbol: AssetSymbol) {
    expect(asset.amount.toString()).to.eq(amount);
    expect(asset.decimals).to.eq(decimals);
    expect(asset.symbol).to.eq(symbol);
  }

  check(Asset.fromString('1 GOLD'), '1', 0, AssetSymbol.GOLD);
  check(Asset.fromString('1. GOLD'), '1', 0, AssetSymbol.GOLD);
  check(Asset.fromString('.1 GOLD'), '1', 1, AssetSymbol.GOLD);
  check(Asset.fromString('0.1 GOLD'), '1', 1, AssetSymbol.GOLD);
  check(Asset.fromString('1.0 SILVER'), '10', 1, AssetSymbol.SILVER);
  check(Asset.fromString('0 SILVER'), '0', 0, AssetSymbol.SILVER);
  check(Asset.fromString('-0.0 SILVER'), '0', 1, AssetSymbol.SILVER);
  check(Asset.fromString('-1.0 SILVER'), '-10', 1, AssetSymbol.SILVER);

  expect(Asset.fromString('1.00001 GOLD').toString()).to.eq('1.00001 GOLD');
  expect(Asset.fromString('0.00001 GOLD').toString()).to.eq('0.00001 GOLD');
  expect(Asset.fromString('.00001 GOLD').toString()).to.eq('0.00001 GOLD');
  expect(Asset.fromString('.1 GOLD').toString()).to.eq('0.1 GOLD');
  expect(Asset.fromString('1.0 GOLD').toString()).to.eq('1.0 GOLD');
});

it('should throw parsing invalid input', () => {
  function check(asset: string, error: string) {
    expect(() => {
      Asset.fromString(asset);
    }).to.throw(AssertionError, error);
  }

  check('1e10 GOLD', 'asset amount must be a valid number');
  check('a100 GOLD', 'asset amount must be a valid number');
  check('100a GOLD', 'asset amount must be a valid number');

  check('1.0 GOLD a', 'invalid asset format');
  check('1', 'invalid asset format');

  check('12345678901234567890123456 GOLD', 'asset amount is too big');
  check('1.0 gold', 'asset type must be GOLD or SILVER');
});

it('should correctly set precision of numbers', () => {
  let a = Asset.fromString('1.5678 GOLD');
  expect(a.decimals).to.eq(4);
  expect(a.amount.toString()).to.eq('15678');

  a = a.setDecimals(2);
  expect(a.decimals).to.eq(2);
  expect(a.amount.toString()).to.eq('156');

  a = a.setDecimals(0);
  expect(a.decimals).to.eq(0);
  expect(a.amount.toString()).to.eq('1');
  expect(a.toString()).to.eq('1 GOLD');

  a = a.setDecimals(4);
  expect(a.decimals).to.eq(4);
  expect(a.amount.toString()).to.eq('10000');

  expect(() => {
    a.setDecimals(-1);
  }).to.throw(AssertionError, 'decimals must be 0 or greater');
});

it('should correctly perform arithmetic and format', () => {
  function check(asset: Asset, amount: string) {
    const internAmt = amount.split(' ')[0].replace('.', '');
    expect(asset.amount.toString()).to.eq(internAmt);
    expect(asset.toString()).to.eq(amount);
  }
  const a = Asset.fromString('123.456 GOLD');
  check(a.add(Asset.fromString('2.0 GOLD')), '125.456 GOLD');
  check(a.add(Asset.fromString('-2.0 GOLD')), '121.456 GOLD');
  check(a.sub(Asset.fromString('2.0 GOLD')), '121.456 GOLD');
  check(a.sub(Asset.fromString('-2.0 GOLD')), '125.456 GOLD');
  check(a.mul(Asset.fromString('100000.11111111 GOLD')), '12345613.7173331961600000 GOLD');
  check(a.mul(Asset.fromString('-100000.11111111 GOLD')), '-12345613.7173331961600000 GOLD');
  check(a.div(Asset.fromString('23 GOLD')), '5.367 GOLD');
  check(a.div(Asset.fromString('-23 GOLD'), 8), '-5.36765217 GOLD');
  check(a, '123.456 GOLD');

  expect(() => {
    a.div(Asset.fromString('0 GOLD'));
  }).to.throw(ArithmeticError, 'divide by zero');
});

it('should throw performing arithmetic on different asset types', () => {
  const a = Asset.fromString('0 GOLD');
  const b = Asset.fromString('0 SILVER');

  function check(func: (asset: Asset) => void) {
    expect(() => {
      func.bind(a)(b);
    }).to.throw(AssertionError, "asset type mismatch");
  }

  check(a.add);
  check(a.sub);
  check(a.div);
  check(a.mul);
});
