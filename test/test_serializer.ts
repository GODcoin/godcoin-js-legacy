import {
  Tx,
  TxType,
  TransferTx,
  RewardTx,
  deserialize
} from '../src/lib/transactions';
import {
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../src/lib/serializer';
import { Block, SignedBlock } from '../src/lib/blockchain';
import { generateKeyPair } from '../src/lib/crypto';
import { Asset } from '../src/lib/asset';
import * as ByteBuffer from 'bytebuffer';
import { AssertionError } from 'assert';
import { expect } from 'chai';
import * as Long from 'long';

it('should serialize primitives', () => {
  const buf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY,
                              ByteBuffer.BIG_ENDIAN);
  const date = new Date(Math.floor(new Date('2018-01-01').getTime() / 1000) * 1000);
  TS.date(buf, date.toString());
  buf.flip();
  expect(TD.date(buf).toUTCString()).to.eq(date.toUTCString());

  buf.clear();
  const keys = generateKeyPair();
  TS.publicKey(buf, keys.publicKey.toWif());
  buf.flip();
  expect(TD.publicKey(buf).toWif()).to.eq(keys.publicKey.toWif());

  buf.clear();
  const asset = '2 GOLD';
  TS.asset(buf, asset);
  expect(TD.asset(buf).toString()).to.eq(asset);
});

it('should serialize transfer transactions', () => {
  const from = generateKeyPair();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    from: from.publicKey,
    to: generateKeyPair().publicKey,
    amount: Asset.fromString('10 GOLD'),
    fee: Asset.fromString('1 GOLD'),
    memo: 'test 123',
    signatures: []
  }).appendSign(from.privateKey);

  const buf = tx.serialize(true);
  const recTx = deserialize<TransferTx>(buf);
  expect(recTx.data).to.eql(tx.data);
});

it('should serialize reward transactions', () => {
  const tx = new RewardTx({
    type: TxType.REWARD,
    timestamp: new Date(),
    to: generateKeyPair().publicKey,
    rewards: [Asset.fromString('10 GOLD'), Asset.fromString('100 SILVER')],
    signatures: []
  });

  const buf = tx.serialize(false);
  const recTx = deserialize<RewardTx>(buf, false);
  expect(recTx.data).to.eql(tx.data);
});

it('should fail on invalid transactions', () => {
  expect(TxType[255]).to.not.exist;
  const tx = new RewardTx({
    type: 255 as any,
    timestamp: new Date(),
    to: generateKeyPair().publicKey,
    rewards: [],
    signatures: []
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
        to: keys.publicKey,
        rewards: [
          Asset.fromString('1 GOLD'),
          Asset.fromString('1 SILVER')
        ],
        signatures: []
      })
    ]
  }).sign(keys);

  const serialized = genesisBlock.fullySerialize(true);
  const recBlock = SignedBlock.fullyDeserialize(serialized);
  expect(recBlock).to.eql(genesisBlock);
});
