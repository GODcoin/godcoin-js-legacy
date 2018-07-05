import * as bs58 from 'bs58';
import { expect } from 'chai';
import {
  generateKeyPair,
  InvalidWif,
  PrivateKey,
  PUB_ADDRESS_PREFIX,
  PublicKey
} from '../src/lib/crypto';

it('should create keys', () => {
  const keys = generateKeyPair();
  expect(keys, 'failed to generate keys').to.exist;
  expect(keys.publicKey, 'failed to generate public key').to.exist;
  expect(keys.privateKey, 'failed to generate private key').to.exist;
  expect(keys.privateKey.extended).to.be.true;

  const pub = keys.publicKey.buffer;
  const priv = keys.privateKey.buffer;
  expect(pub.equals(priv), 'public key should not equal private key').is.false;
});

it('should recover public key from a private key', () => {
  const keys = generateKeyPair();
  const pub = keys.privateKey.toPub().buffer;

  expect(keys.publicKey.buffer.equals(pub), 'public keys do not match').is.true;
});

it('should recreate keys from a compressed WIF', () => {
  const keys = generateKeyPair();
  const publicWif = keys.publicKey.toWif();
  const privateWif = keys.privateKey.toWif();

  expect(keys.publicKey.toString()).to.eq(publicWif);
  expect(keys.privateKey.toString()).to.eq(privateWif);

  const pubKey = PublicKey.fromWif(publicWif);
  const recKeys = PrivateKey.fromWif(privateWif);

  expect(pubKey.buffer.equals(keys.publicKey.buffer)).is.true;
  expect(pubKey.equals(keys.publicKey)).is.true;
  expect(recKeys.privateKey.buffer.equals(keys.privateKey.buffer)).is.true;
  expect(recKeys.privateKey.equals(keys.privateKey)).is.true;

  expect(pubKey.toWif()).is.eq(publicWif);
  expect(recKeys.publicKey.toWif()).is.eq(publicWif);
  expect(recKeys.privateKey.toWif()).is.eq(privateWif);
});

it('should recreate keypairs from an extended private key', () => {
  const keys = generateKeyPair();
  const recKeys = PrivateKey.fromWif(keys.privateKey.toWif(true));
  expect(keys.privateKey.equals(recKeys.privateKey)).to.be.true;
  expect(keys.publicKey.equals(recKeys.publicKey)).to.be.true;
  expect(recKeys.privateKey.extended).to.be.false;
});

it('should import keys from WIF', () => {
  const {
    privateKey,
    publicKey
  } = PrivateKey.fromWif('3GAD3otqozDorfu1iDpMQJ1gzWp8PRFEjVHZivZdedKW3i3KtM');
  expect(privateKey.toWif()).to.eq('3GAD3otqozDorfu1iDpMQJ1gzWp8PRFEjVHZivZdedKW3i3KtM');
  expect(publicKey.toWif()).to.eq('GOD52QZDBUStV5CudxvKf6bPsQeN7oeKTkEm2nAU1vAUqNVexGTb8');
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
    // Private key and public key has a different prefix
    const buf = bs58.decode(keys.privateKey.toWif());
    PublicKey.fromWif('GOD' + bs58.encode(buf));
  }).to.throw(InvalidWif, 'invalid prefix');

  expect(() => {
    const buf = bs58.decode(keys.privateKey.toWif());
    for (let i = 0; i < 4; ++i) buf[buf.length - i - 1] = 0;
    PrivateKey.fromWif(bs58.encode(buf));
  }).to.throw(InvalidWif, 'invalid checksum');

  expect(() => {
    const wif = keys.publicKey.toWif().slice(PUB_ADDRESS_PREFIX.length);
    PublicKey.fromWif(wif);
  }).to.throw(InvalidWif, 'wif must start with ' + PUB_ADDRESS_PREFIX);

  expect(keys.privateKey).to.have.property('seed');
  (keys.privateKey as any).seed = undefined;
  expect(keys.privateKey.extended).to.be.false;
  expect(keys.privateKey.seed).to.be.undefined;
  expect(() => {
    keys.privateKey.toWif();
  }).to.throw(InvalidWif, 'cannot created compressed wif without seed');
});

it('should properly sign and validate', () => {
  const keys = generateKeyPair();
  const msg = Buffer.from('Hello world!');
  const sig = keys.privateKey.sign(msg);
  expect(keys.publicKey.verify(sig.signature, msg)).is.true;

  const badKeys = generateKeyPair();
  expect(badKeys.publicKey.verify(sig.signature, msg)).is.false;
});

it('should throw on invalid key lengths', () => {
  expect(() => {
    new PrivateKey(Buffer.alloc(32));
  }).to.throw(Error, 'invalid key length (got 32 bytes)');

  expect(() => {
    new PrivateKey(Buffer.alloc(64), Buffer.alloc(16));
  }).to.throw(Error, 'invalid seed length (got 16 bytes)');

  expect(() => {
    new PublicKey(Buffer.alloc(64));
  }).to.throw(Error, 'invalid key length (got 64 bytes)');
});
