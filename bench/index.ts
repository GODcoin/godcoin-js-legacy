import * as Benchmark from 'benchmark';
import { Asset, AssetSymbol } from 'godcoin-neon';
import * as sodium from 'libsodium-wrappers';
import { generateKeyPair } from '../src/lib/crypto';
import { TransferTx, TxType } from '../src/lib/transactions';

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
    signature_pairs: []
  }).appendSign(keyA.privateKey);

  let suite: Benchmark.Suite;

  suite = new Benchmark.Suite('Crypto');
  suite.add('sign transaction', () => {
    tx.sign(keyA.privateKey);
  }).on('start', evt => {
    console.log(evt.currentTarget.name);
  }).on('cycle', evt => {
    console.log('  ', evt.target.toString());
  }).run();

  suite = new Benchmark.Suite('Serialization');
  suite.add('string to asset', () => {
    Asset.fromString('1.123 GOLD');
  }).add('asset to string', () => {
    new Asset(1123, 3, AssetSymbol.GOLD).toString();
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
