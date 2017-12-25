import * as sodium from 'libsodium-wrappers';

before(async () => {
  await sodium.ready;
});

describe('Asset', () => {
  require('./test_asset');
});

describe('Crypto', () => {
  require('./test_crypto');
});

