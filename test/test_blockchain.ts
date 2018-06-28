import {
  SignedBlock,
  Blockchain,
  Block,
} from '../src/lib/blockchain';
import { TxType, RewardTx, TransferTx } from '../src/lib/transactions';
import { generateKeyPair, KeyPair } from '../src/lib/crypto';
import { Asset, AssetSymbol } from '../src/lib/asset';
import { SkipFlags } from '../src/lib/skip_flags';
import { TxPool } from '../src/lib/producer';
import { AssertionError } from 'assert';
import { expect } from 'chai';
import * as path from 'path';
import * as Long from 'long';
import * as del from 'del';
import * as os from 'os';
import * as fs from 'fs';

let genesisKeys: KeyPair;
let testDir: string;
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
  const genesisBlock = new Block({
    height: Long.fromNumber(0, true),
    previous_hash: undefined!,
    timestamp: new Date(),
    transactions: [
      new RewardTx({
        type: TxType.REWARD,
        timestamp: new Date(0),
        fee: Asset.fromString('0 GOLD'),
        to: genesisKeys.publicKey,
        rewards: [ Asset.fromString('1 GOLD') ],
        signature_pairs: []
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

it('should have correct balances in the blockchain', async () => {
  const goldFee = new Asset(BigInt(1), 0, AssetSymbol.GOLD);
  const silverFee = new Asset(BigInt(10), 0, AssetSymbol.SILVER);
  const txFrom = generateKeyPair();
  const txTo = generateKeyPair();

  // Add the genesis block
  {
    const ts = new Date();
    const b = new Block({
      height: Long.fromNumber(0, true),
      previous_hash: undefined!,
      timestamp: ts,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          to: genesisKeys.publicKey,
          timestamp: new Date(0),
          fee: goldFee,
          rewards: [
            Asset.fromString('0.1 GOLD'),
            Asset.fromString('10 SILVER')
          ],
          signature_pairs: []
        }),
        new RewardTx({
          type: TxType.REWARD,
          to: txFrom.publicKey,
          timestamp: new Date(0),
          fee: goldFee,
          rewards: [
            Asset.fromString('20 GOLD'),
            Asset.fromString('20 SILVER')
          ],
          signature_pairs: []
        }),
      ]
    }).sign(genesisKeys);
    await chain.addBlock(b);
  }

  for (let i = 1; i <= 10; ++i) {
    const ts = new Date();
    const b = new Block({
      height: Long.fromNumber(i, true),
      previous_hash: chain.head.getHash(),
      timestamp: ts,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          to: genesisKeys.publicKey,
          timestamp: new Date(0),
          fee: goldFee,
          rewards: [
            Asset.fromString('0.1 GOLD'),
            Asset.fromString('10 SILVER')
          ],
          signature_pairs: []
        }),
        new RewardTx({
          type: TxType.REWARD,
          to: txFrom.publicKey,
          timestamp: new Date(0),
          fee: goldFee,
          rewards: [
            Asset.fromString('1.1 GOLD'),
            Asset.fromString('11 SILVER')
          ],
          signature_pairs: []
        }),
        new TransferTx({
          type: TxType.TRANSFER,
          timestamp: ts,
          from: txFrom.publicKey,
          to: txTo.publicKey,
          amount: Asset.fromString('0.1 GOLD'),
          fee: goldFee,
          signature_pairs: []
        }).appendSign(txFrom.privateKey),
        new TransferTx({
          type: TxType.TRANSFER,
          timestamp: ts,
          from: txFrom.publicKey,
          to: txTo.publicKey,
          amount: Asset.fromString('1.0 SILVER'),
          fee: silverFee,
          signature_pairs: []
        }).appendSign(txFrom.privateKey)
      ]
    }).sign(genesisKeys);
    await chain.addBlock(b, SkipFlags.SKIP_TX);
  }

  let bal = await chain.getBalance(genesisKeys.publicKey);
  expect(bal[0].toString()).to.eq('1.1 GOLD');
  expect(bal[1].toString()).to.eq('110 SILVER');

  // Extra balance is obtained from the genesis block
  bal = await chain.getBalance(txFrom.publicKey);
  expect(bal[0].toString()).to.eq('20.0 GOLD');
  expect(bal[1].toString()).to.eq('20.0 SILVER');

  bal = await chain.getBalance(txTo.publicKey);
  expect(bal[0].toString()).to.eq('1.0 GOLD');
  expect(bal[1].toString()).to.eq('10.0 SILVER');
});

it('should have correct balances in the tx pool', async () => {
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
          timestamp: new Date(0),
          fee: Asset.fromString('0 GOLD'),
          rewards: [
            Asset.fromString('1 GOLD'),
            Asset.fromString('10 SILVER')
          ],
          signature_pairs: []
        })
      ]
    }).sign(genesisKeys);
    await chain.addBlock(b);
  }

  const txTo = generateKeyPair();
  const pool = new TxPool(chain);
  {
    const tx = Buffer.from(new TransferTx({
      type: TxType.TRANSFER,
      timestamp: new Date(),
      from: genesisKeys.publicKey,
      to: txTo.publicKey,
      amount: Asset.fromString('5 GOLD'),
      fee: Asset.fromString('5 GOLD'),
      signature_pairs: []
    }).appendSign(genesisKeys.privateKey).serialize(true).toBuffer());
    const hex = tx.toString('hex');
    await pool.push(tx, hex);
    await expect(pool.push(tx, hex)).to.be.rejectedWith(AssertionError, 'duplicate tx');
  }

  let bal = await pool.getBalance(genesisKeys.publicKey);
  expect(bal[0].toString()).to.eq('0 GOLD');
  expect(bal[1].toString()).to.eq('100 SILVER');

  bal = await pool.getBalance(txTo.publicKey);
  expect(bal[0].toString()).to.eq('5 GOLD');
  expect(bal[1].toString()).to.eq('0 SILVER');
});

it('should throw on invalid balance in the tx pool', async () => {
  await chain.addBlock(new Block({
    height: Long.fromNumber(0, true),
    previous_hash: undefined!,
    timestamp: new Date(),
    transactions: [
      new RewardTx({
        type: TxType.REWARD,
        to: genesisKeys.publicKey,
        timestamp: new Date(0),
        fee: Asset.fromString('0 GOLD'),
        rewards: [
          Asset.fromString('10 GOLD'),
          Asset.fromString('10 SILVER')
        ],
        signature_pairs: []
      })
    ]
  }).sign(genesisKeys));

  const pool = new TxPool(chain);
  const txTo = generateKeyPair();

  const tx = Buffer.from(new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    from: genesisKeys.publicKey,
    to: txTo.publicKey,
    amount: Asset.fromString('10 GOLD'),
    fee: Asset.fromString('1 GOLD'),
    signature_pairs: []
  }).appendSign(genesisKeys.privateKey).serialize(true).toBuffer());
  await expect(pool.push(tx, tx.toString('hex'))).to.be.rejectedWith(AssertionError, 'insufficient balance');

  let bal = await chain.getBalance(genesisKeys.publicKey);
  expect(bal[0].toString()).to.eq('10 GOLD');
  expect(bal[1].toString()).to.eq('10 SILVER');

  bal = await chain.getBalance(txTo.publicKey);
  expect(bal[0].toString()).to.eq('0 GOLD');
  expect(bal[1].toString()).to.eq('0 SILVER');
});
