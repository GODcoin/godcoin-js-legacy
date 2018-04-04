import * as chaiAsPromised from 'chai-as-promised';
import * as sodium from 'libsodium-wrappers';
import * as chai from 'chai';

chai.use(chaiAsPromised);

before(async () => {
  await sodium.ready;
});

describe('Asset', () => {
  require('./test_asset');
});

describe('Crypto', () => {
  require('./test_crypto');
});

describe('Serialization', () => {
  require('./test_serializer');
});

describe('Blockchain', () => {
  require('./test_blockchain');
});

describe('Lock', () => {
  require('./test_lock');
});
