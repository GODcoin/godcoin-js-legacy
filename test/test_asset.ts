import { expect } from 'chai';
import {
  Asset,
  AssetSymbol
} from 'godcoin-neon';

it('should parse valid input', () => {
  expect(Asset.fromString('1.00001 GOLD').toString()).to.eq('1.00001 GOLD');
  expect(Asset.fromString('0.00001 GOLD').toString()).to.eq('0.00001 GOLD');
  expect(Asset.fromString('-0.00001 GOLD').toString()).to.eq('-0.00001 GOLD');
  expect(Asset.fromString('.00001 GOLD').toString()).to.eq('0.00001 GOLD');
  expect(Asset.fromString('.1 GOLD').toString()).to.eq('0.1 GOLD');
  expect(Asset.fromString('1.0 GOLD').toString()).to.eq('1.0 GOLD');
});

it('should throw parsing invalid input', () => {
  function check(asset: string, error: string) {
    expect(() => {
      Asset.fromString(asset);
    }).to.throw(Error, error);
  }

  check('1e10 GOLD', 'invalid amount');
  check('a100 GOLD', 'invalid amount');
  check('100a GOLD', 'invalid amount');

  check('1.0 GOLD a', 'invalid asset type');
  check('1', 'invalid format');

  check('1234567890123456789012345678 GOLD', 'asset string too large');
  check('1.0 gold', 'invalid asset type');
});

it('should correctly perform arithmetic and format', () => {
  function check(asset: Asset, amount: string) {
    expect(asset.toString()).to.eq(amount);
  }
  const a = Asset.fromString('123.456 GOLD');
  check(a.add(Asset.fromString('2.0 GOLD')), '125.456 GOLD');
  check(a.add(Asset.fromString('-2.0 GOLD')), '121.456 GOLD');
  check(a.sub(Asset.fromString('2.0 GOLD')), '121.456 GOLD');
  check(a.sub(Asset.fromString('-2.0 GOLD')), '125.456 GOLD');
  check(a.mul(Asset.fromString('100000.11111111 GOLD'), 8), '12345613.71733319 GOLD');
  check(a.mul(Asset.fromString('-100000.11111111 GOLD'), 8), '-12345613.71733319 GOLD');
  check(a.div(Asset.fromString('23 GOLD'), 3), '5.367 GOLD');
  check(a.div(Asset.fromString('-23 GOLD'), 8), '-5.36765217 GOLD');
  check(a.pow(2, 3), '15241.383 GOLD');
  check(a.pow(2, 8), '15241.38393600 GOLD');
  check(a, '123.456 GOLD');

  check(Asset.fromString('10 GOLD').div(Asset.fromString('2 GOLD'), 0), '5 GOLD');
  check(Asset.fromString('5 GOLD').div(Asset.fromString('10 GOLD'), 1), '0.5 GOLD');

  expect(a.div(Asset.fromString('0 GOLD'), 1)).to.be.undefined;
});

it('should compare assets correctly', () => {
  expect(Asset.fromString('1 GOLD').gt(Asset.fromString('0.50 GOLD'))).to.be.true;
  expect(Asset.fromString('1.0 GOLD').gt(Asset.fromString('0.99 GOLD'))).to.be.true;

  expect(Asset.fromString('1 GOLD').geq(Asset.fromString('1.0 GOLD'))).to.be.true;
  expect(Asset.fromString('0.1 GOLD').geq(Asset.fromString('1.0 GOLD'))).to.be.false;

  expect(Asset.fromString('1 GOLD').leq(Asset.fromString('1.0 GOLD'))).to.be.true;
  expect(Asset.fromString('0.1 GOLD').leq(Asset.fromString('1.0 GOLD'))).to.be.true;
  expect(Asset.fromString('5.0 GOLD').leq(Asset.fromString('10 GOLD'))).to.be.true;

  expect(Asset.fromString('1 GOLD').eq(Asset.fromString('1 GOLD'))).to.be.true;
  expect(Asset.fromString('1 GOLD').gt(Asset.fromString('1 GOLD'))).to.be.false;
  expect(Asset.fromString('1 GOLD').lt(Asset.fromString('1 GOLD'))).to.be.false;
});

it('should throw performing arithmetic on different asset types', () => {
  const a = new Asset(0, 0, AssetSymbol.GOLD);
  const b = new Asset(0, 0, AssetSymbol.SILVER);

  function checkArithmetic(func: (asset: Asset) => void) {
    expect(func.call(a, b, 0)).to.be.undefined;
  }

  checkArithmetic(a.add);
  checkArithmetic(a.sub);
  checkArithmetic(a.div);
  checkArithmetic(a.mul);

  function checkComparison(func: (asset: Asset) => void) {
    expect(() => {
      func.call(a, b);
    }).to.throw(Error, 'asset symbol mismatch');
  }

  checkComparison(a.gt);
  checkComparison(a.geq);
  checkComparison(a.lt);
  checkComparison(a.leq);
  checkComparison(a.eq);
});

it('should throw on invalid asset symbol', () => {
  expect(() => {
    new Asset(0, 0, 3);
  }).to.throw(Error, 'invalid symbol identifier');
});
