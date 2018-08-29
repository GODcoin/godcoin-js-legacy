import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as sodium from 'libsodium-wrappers';

chai.use(chaiAsPromised);

before(async () => {
  await sodium.ready;
});

describe('Asset', () => {
  require('./test_asset');
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

describe('CLI', () => {
  require('./test_cli');
});
