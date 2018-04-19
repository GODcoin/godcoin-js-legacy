import { TransferTx, TxType } from '../src/lib/transactions';
import { KeyPair, generateKeyPair } from '../src/lib/crypto';
import * as sodium from 'libsodium-wrappers';
import { Asset, AssetSymbol } from '../src/lib/asset';
import * as Benchmark from 'benchmark';
import * as bigInt from 'big-integer';

(async () => {
  await sodium.ready;
  console.log('Starting benchmark...');
  console.log();

  const keyA = generateKeyPair();
  const keyB = generateKeyPair();
  const amount = Asset.fromString('1 GOLD');
  const time = new Date();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: time,
    from: keyA.publicKey,
    to: keyB.publicKey,
    amount,
    fee: amount,
    memo: Buffer.alloc(512),
    signatures: []
  }).appendSign(keyA.privateKey);

  let suite: Benchmark.Suite;

  suite = new Benchmark.Suite('Crypto');
  suite.add('sign transaction', () => {
    tx.sign(keyA.privateKey);
  }).add('verify transaction', () => {
    tx.validate();
  }).on('start', evt => {
    console.log(evt.currentTarget.name);
  }).on('cycle', evt => {
    console.log('  ', evt.target.toString());
  }).run();

  suite = new Benchmark.Suite('Serialization');
  suite.add('string to asset', () => {
    Asset.fromString('1.123 GOLD');
  }).add('asset to string', () => {
    new Asset(bigInt(1123), 3, AssetSymbol.GOLD).toString();
  }).add('serialize transaction', () => {
    tx.serialize(true);
  }).on('start', evt => {
    console.log(evt.currentTarget.name);
  }).on('cycle', evt => {
    console.log('  ', evt.target.toString());
  }).run();

  console.log('\nBenchmark finished\n');
})().catch(err => {
  console.log(err);
});
