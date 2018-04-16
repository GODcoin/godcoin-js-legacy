import { Wallet } from '../../src/cli/wallet';
import { expect } from 'chai';

it('should parse lines', () => {
  let args;

  args = Wallet.parse(`aa ab ac`);
  expect(args).to.eql(['aa', 'ab', 'ac']);

  args = Wallet.parse(`123 123 123`);
  expect(args).to.eql(['123', '123', '123']);

  args = Wallet.parse(`123 "a b c" test`);
  expect(args).to.eql(['123', 'a b c', 'test']);

  args = Wallet.parse(`123 abc "1 2 3"`);
  expect(args).to.eql(['123', 'abc', '1 2 3']);

  args = Wallet.parse(`123 \\"abc 1 2 3\\"`);
  expect(args).to.eql(['123', '"abc', '1', '2', '3"']);
});

it('should fail to parse invalid input', () => {
  expect(() => {
    Wallet.parse(`123 abc "1 2 3`);
  }).to.throw(Error, 'Expected closing " character');

  expect(() => {
    Wallet.parse(`123 a"bc 1 2 3`);
  }).to.throw(Error, 'Unexpected " character at pos 5');
});
