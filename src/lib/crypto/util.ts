import * as crypto from 'crypto';

export function doubleSha256(val: Buffer|string): Buffer {
  return sha256(sha256(val));
}

function sha256(val: Buffer|string): Buffer {
  return crypto.createHash('sha256').update(val).digest();
}
