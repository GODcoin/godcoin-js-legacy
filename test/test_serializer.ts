import { AssertionError } from 'assert';
import * as ByteBuffer from 'bytebuffer';
import { expect } from 'chai';
import * as Long from 'long';
import { Asset, EMPTY_GOLD } from '../src/lib/asset';
import { Block, SignedBlock } from '../src/lib/blockchain';
import { generateKeyPair } from '../src/lib/crypto';
import {
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../src/lib/serializer';
import {
  BondTx,
  deserialize,
  RewardTx,
  TransferTx,
  TxType
} from '../src/lib/transactions';

it('should serialize primitives', () => {
  const buf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY,
                              ByteBuffer.BIG_ENDIAN);
  const date = new Date(Math.floor(new Date('2018-01-01').getTime() / 1000) * 1000);
  TS.date(buf, date);
  expect(TD.date(buf.flip()).toUTCString()).to.eq(date.toUTCString());

  buf.clear();
  const keys = generateKeyPair();
  TS.publicKey(buf, keys.publicKey);
  expect(TD.publicKey(buf.flip()).toWif()).to.eq(keys.publicKey.toWif());

  buf.clear();
  const asset = Asset.fromString('2 GOLD');
  TS.asset(buf, asset);
  expect(TD.asset(buf.flip()).toString()).to.eq(asset.toString());

  buf.clear();
  TS.string(buf, undefined!);
  expect(TD.string(buf.flip())).to.be.undefined;

  buf.clear();
  const tmp = new ByteBuffer(8, ByteBuffer.BIG_ENDIAN);
  tmp.writeUint64(Number.MAX_SAFE_INTEGER);
  TS.buffer(buf, tmp.flip());
  expect(TD.buffer(buf.flip())).to.eql(tmp.buffer);
});

it('should serialize bond transactions', () => {
  const tx = new BondTx({
    type: TxType.BOND,
    timestamp: new Date(),
    fee: EMPTY_GOLD,
    minter: generateKeyPair().publicKey,
    staker: generateKeyPair().publicKey,
    bond_fee: EMPTY_GOLD,
    stake_amt: EMPTY_GOLD,
    signature_pairs: []
  });

  const buf = tx.serialize(false);
  const recTx = deserialize<RewardTx>(buf, false);
  expect(recTx.data).to.eql(tx.data);
});

it('should serialize reward transactions', () => {
  const tx = new RewardTx({
    type: TxType.REWARD,
    timestamp: new Date(),
    fee: EMPTY_GOLD,
    to: generateKeyPair().publicKey,
    rewards: [Asset.fromString('10 GOLD'), Asset.fromString('100 SILVER')],
    signature_pairs: []
  });

  const buf = tx.serialize(false);
  const recTx = deserialize<RewardTx>(buf, false);
  expect(recTx.data).to.eql(tx.data);
});

it('should serialize transfer transactions', () => {
  const from = generateKeyPair();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    fee: Asset.fromString('0.00000001 GOLD'),
    signature_pairs: [],
    from: from.publicKey,
    to: generateKeyPair().publicKey,
    amount: Asset.fromString('10 GOLD'),
    memo: Buffer.from('test 123')
  }).appendSign(from.privateKey);

  const buf = tx.serialize(true);
  const recTx = deserialize<TransferTx>(buf);
  expect(recTx.data).to.eql(tx.data);
  expect(recTx.toString()).to.eql(tx.toString());
});

it('should serialize transfer transactions with empty memo', () => {
  const from = generateKeyPair();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    fee: Asset.fromString('0.00000001 GOLD'),
    signature_pairs: [],
    from: from.publicKey,
    to: generateKeyPair().publicKey,
    amount: Asset.fromString('10 GOLD'),
    memo: undefined
  }).appendSign(from.privateKey);

  const buf = tx.serialize(true);
  const recTx = deserialize<TransferTx>(buf);
  expect(recTx.data).to.eql(tx.data);
  expect(recTx.toString()).to.eql(tx.toString());
});

it('should fail on invalid transactions', () => {
  expect(TxType[255]).to.not.exist;
  const tx = new RewardTx({
    type: 255 as any,
    timestamp: new Date(),
    fee: Asset.fromString('0 GOLD'),
    to: generateKeyPair().publicKey,
    rewards: [],
    signature_pairs: []
  });

  const buf = tx.serialize(false);
  expect(() => {
    deserialize<RewardTx>(buf, false);
  }).to.throw(AssertionError, 'unhandled type: 255');
});

it('should serialize blocks', () => {
  const keys = generateKeyPair();
  const genesisTs = new Date();
  const genesisBlock = new Block({
    height: Long.fromNumber(1, true),
    timestamp: genesisTs,
    previous_hash: undefined as any,
    transactions: [
      new RewardTx({
        type: TxType.REWARD,
        timestamp: genesisTs,
        fee: Asset.fromString('0 GOLD'),
        to: keys.publicKey,
        rewards: [
          Asset.fromString('1 GOLD'),
          Asset.fromString('1 SILVER')
        ],
        signature_pairs: []
      })
    ]
  }).sign(keys);

  const serialized = genesisBlock.fullySerialize();
  const recBlock = SignedBlock.fullyDeserialize(serialized);
  expect(recBlock).to.eql(genesisBlock);
});
