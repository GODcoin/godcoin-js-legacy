import {
  Blockchain,
  ChainStore,
  Block
} from '../src/lib/blockchain';
import { TxType, RewardTx, TransferTx } from '../src/lib/transactions';
import { generateKeyPair, KeyPair } from '../src/lib/crypto';
import { Indexer } from '../src/lib/indexer';
import { Asset } from '../src/lib/asset';
import { AssertionError } from 'assert';
import { expect } from 'chai';
import * as path from 'path';
import * as util from 'util';
import * as Long from 'long';
import * as del from 'del';
import * as os from 'os';
import * as fs from 'fs';

let genesisKeys: KeyPair;
let testDir: string;
let store: ChainStore;
let chain: Blockchain;

beforeEach(async () => {
  genesisKeys = generateKeyPair();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'godcoin-'));

  const indexer = new Indexer(path.join(testDir, 'blkindex'));
  store = new ChainStore(path.join(testDir, 'blklog'), indexer);
  chain = new Blockchain(store, indexer);
  await chain.start();
});

afterEach(async () => {
  await chain.stop();
  del.sync(testDir, {
    force: true
  });
});

it('should read and write the genesis block', async () => {
  const genesisTs = new Date();
  const genesisBlock = new Block({
    height: Long.fromNumber(0, true),
    previous_hash: undefined as any,
    timestamp: genesisTs,
    transactions: [
      new RewardTx({
        type: TxType.REWARD,
        timestamp: genesisTs,
        to: genesisKeys.publicKey,
        rewards: [ Asset.fromString('1 GOLD') ],
        signatures: []
      })
    ]
  }).sign(genesisKeys);
  await chain.addBlock(genesisBlock);
  const block = await chain.getBlock(0);
  expect(block).to.eql(genesisBlock);
});

it('should fail previous hash validation', async () => {
  {
    const genesisBlock = new Block({
      height: Long.fromNumber(0, true),
      previous_hash: undefined as any,
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await chain.addBlock(genesisBlock);
  }
  {
    const block = new Block({
      height: Long.fromNumber(1, true),
      previous_hash: '',
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await expect(chain.addBlock(block)).to.be
            .rejectedWith(AssertionError, 'previous hash does not match');
  }
});

it('should fail with incorrect height', async () => {
  {
    const genesisBlock = new Block({
      height: Long.fromNumber(0, true),
      previous_hash: undefined as any,
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await chain.addBlock(genesisBlock);
  }
  {
    const block = new Block({
      height: Long.fromNumber(2, true),
      previous_hash: '',
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await expect(chain.addBlock(block)).to.be
            .rejectedWith(AssertionError, 'unexpected height');
  }
});
