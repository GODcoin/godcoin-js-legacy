import {
  SignedBlock,
  Blockchain,
  ChainStore,
  Block,
} from '../src/lib/blockchain';
import { TxType, RewardTx, TransferTx } from '../src/lib/transactions';
import { generateKeyPair, KeyPair } from '../src/lib/crypto';
import { Asset, AssetSymbol } from '../src/lib/asset';
import { Indexer } from '../src/lib/indexer';
import { AssertionError } from 'assert';
import * as bigInt from 'big-integer';
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
  chain = new Blockchain(testDir);
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
        fee: Asset.fromString('0 GOLD'),
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

it('should read the latest block', async () => {
  let block!: SignedBlock;
  let prevBlock!: SignedBlock;
  for (let i = 0; i <= 10; ++i) {
    const hash = prevBlock ? prevBlock.getHash() : undefined;
    block = new Block({
      height: Long.fromNumber(i, true),
      previous_hash: hash as any,
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await chain.addBlock(block);
    prevBlock = block;
  }
  expect(chain.head).to.eql(block);
});

it('should read any previous block', async () => {
  let block!: SignedBlock;
  for (let i = 0; i <= 10; ++i) {
    const hash = i === 0 ? undefined : chain.head.getHash();
    const b = new Block({
      height: Long.fromNumber(i, true),
      previous_hash: hash as any,
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    if (i === 5) block = b;
    await chain.addBlock(b);
  }
  const b = await chain.getBlock(5);
  expect(b).to.eql(block);
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
      previous_hash: Buffer.alloc(0),
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
      previous_hash: Buffer.alloc(0),
      timestamp: new Date(),
      transactions: []
    }).sign(genesisKeys);
    await expect(chain.addBlock(block)).to.be
            .rejectedWith(AssertionError, 'unexpected height');
  }
});

it('should have correct balances', async () => {
  const goldFee = new Asset(bigInt(1), 0, AssetSymbol.GOLD);
  const silverFee = new Asset(bigInt(1), 0, AssetSymbol.SILVER);
  const txFrom = generateKeyPair();
  const txTo = generateKeyPair();
  for (let i = 0; i < 10; ++i) {
    const hash = i === 0 ? undefined : chain.head.getHash();
    const ts = new Date();
    const b = new Block({
      height: Long.fromNumber(i, true),
      previous_hash: hash as any,
      timestamp: ts,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          to: genesisKeys.publicKey,
          timestamp: ts,
          fee: goldFee,
          rewards: [
            Asset.fromString('0.1 GOLD'),
            Asset.fromString('10 SILVER')
          ],
          signatures: []
        }),
        new TransferTx({
          type: TxType.TRANSFER,
          timestamp: ts,
          from: txFrom.publicKey,
          to: txTo.publicKey,
          amount: Asset.fromString('0.1 GOLD'),
          fee: goldFee,
          signatures: []
        }).appendSign(txFrom.privateKey),
        new TransferTx({
          type: TxType.TRANSFER,
          timestamp: ts,
          from: txFrom.publicKey,
          to: txTo.publicKey,
          amount: Asset.fromString('1.0 SILVER'),
          fee: silverFee,
          signatures: []
        }).appendSign(txFrom.privateKey)
      ]
    }).sign(genesisKeys);
    await chain.addBlock(b);
  }

  let bal = await chain.getBalance(genesisKeys.publicKey);
  expect(bal[0].toString()).to.eq('1.0 GOLD');
  expect(bal[1].toString()).to.eq('100 SILVER');

  bal = await chain.getBalance(txFrom.publicKey);
  expect(bal[0].toString()).to.eq('-11.0 GOLD');
  expect(bal[1].toString()).to.eq('-20.0 SILVER');

  bal = await chain.getBalance(txTo.publicKey);
  expect(bal[0].toString()).to.eq('1.0 GOLD');
  expect(bal[1].toString()).to.eq('10.0 SILVER');
});
