import * as crypto from 'crypto';
import * as sodium from 'libsodium-wrappers';
import { PrivateKey } from './private_key';
import { PublicKey } from './public_key';

export { doubleSha256 } from './util';
export * from './invalid_wif';
export * from './private_key';
export * from './public_key';

export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export interface SigPair {
  public_key: PublicKey;
  signature: Buffer;
}

export function generateKeyPair(): KeyPair {
  const seed = crypto.randomBytes(32);
  const keys = sodium.crypto_sign_seed_keypair(seed);
  return {
    privateKey: new PrivateKey(Buffer.from(keys.privateKey), seed),
    publicKey: new PublicKey(Buffer.from(keys.publicKey))
  };
}
