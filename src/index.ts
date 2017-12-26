import { Blockchain, SignedBlock, Block } from './blockchain';
import { generateKeyPair, doubleSha256 } from './crypto';
import { TxType, TransferTx } from './transactions';
import * as sodium from 'libsodium-wrappers';
import { Asset } from './asset';
import * as Long from 'long';

(async () => {
  await sodium.ready;
  const genesisKeys = generateKeyPair();
  console.log('Genesis minter private WIF: ' + genesisKeys.privateKey.toWif());
  console.log('Genesis minter public WIF: ' + genesisKeys.publicKey.toWif());

  const genesisBlock = new Block({
    height: Long.fromNumber(0),
    timestamp: new Date(),
    previous_hash: '00000000000000000000000000000000',
    transactions: [],
    tx_merkle_root: '00000000000000000000000000000000'
  }).sign(genesisKeys);

  const chain = new Blockchain(genesisBlock);
  for (let i = 0; i < 10; ++i) {
    const b = Block.createBlock(chain.getLatestBlock(), []).sign(generateKeyPair());
    chain.addBlock(b);
  }
  console.log(chain);
})().catch(e => {
  console.error(e);
});
