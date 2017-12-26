import {
  PUB_ADDRESS_PREFIX,
  InvalidWif,
  PublicKey,
  PrivateKey,
  generateKeyPair
} from '../src/crypto';
import { expect } from 'chai';
import * as bs58 from 'bs58';

it('should create keys', () => {
  const keys = generateKeyPair();
  expect(keys, 'Failed to generate keys').to.exist;
  expect(keys.publicKey, 'Failed to generate public key').to.exist;
  expect(keys.privateKey, 'Failed to generate private key').to.exist;

  const pub = keys.publicKey.buffer;
  const priv = keys.privateKey.buffer;
  expect(pub.equals(priv), 'Public key should not equal private key').is.false;
});

it('should recreate keys from WIF', () => {
  const keys = generateKeyPair();
  const publicWif = keys.publicKey.toWif();
  const privateWif = keys.privateKey.toWif();

  expect(keys.publicKey.toString()).to.eq(publicWif);
  expect(keys.privateKey.toString()).to.eq(privateWif);

  const pubKey = PublicKey.fromWif(publicWif);
  const recKeys = PrivateKey.fromWif(privateWif);

  expect(pubKey.buffer.equals(keys.publicKey.buffer)).is.true;
  expect(recKeys.privateKey.buffer.equals(keys.privateKey.buffer)).is.true;

  expect(pubKey.toWif()).is.eq(publicWif);
  expect(recKeys.publicKey.toWif()).is.eq(publicWif);
  expect(recKeys.privateKey.toWif()).is.eq(privateWif);
});

it('should throw on invalid key', () => {
  expect(() => {
    PrivateKey.fromWif('');
  }).to.throw(InvalidWif, 'wif not provided');

  const keys = generateKeyPair();
  expect(() => {
    const buf = bs58.decode(keys.privateKey.toWif());
    buf[0] = 0;
    PrivateKey.fromWif(bs58.encode(buf));
  }).to.throw(InvalidWif, 'invalid prefix');

  expect(() => {
    const buf = bs58.decode(keys.privateKey.toWif());
    buf[buf.length - 1] = 0;
    PrivateKey.fromWif(bs58.encode(buf));
  }).to.throw(InvalidWif, 'invalid checksum');

  expect(() => {
    const wif = keys.publicKey.toWif().slice(PUB_ADDRESS_PREFIX.length);
    PublicKey.fromWif(wif);
  }).to.throw(InvalidWif, 'wif must start with ' + PUB_ADDRESS_PREFIX);
});

it('should properly sign and validate', () => {
  const keys = generateKeyPair();
  const msg = Buffer.from('Hello world!');
  const sig = keys.privateKey.sign(msg);
  expect(keys.publicKey.verify(sig, msg)).is.true;

  const badKeys = generateKeyPair();
  expect(badKeys.publicKey.verify(sig, msg)).is.false;
});
