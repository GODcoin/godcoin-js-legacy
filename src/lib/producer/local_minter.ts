import * as assert from 'assert';
import {
  Asset,
  AssetSymbol,
  Block,
  BondTx,
  KeyPair,
  PrivateKey,
  RewardTx
} from 'godcoin-neon';
import { Blockchain } from '../blockchain';
import { TxPool } from './tx_pool';

const REWARD_GOLD = new Asset(1, 0, AssetSymbol.GOLD);
const REWARD_SILVER = new Asset(100, 0, AssetSymbol.SILVER);

export class LocalMinter {

  constructor(private readonly blockchain: Blockchain,
              private readonly pool: TxPool,
              readonly keys: KeyPair) {
    this.blockchain = blockchain;
    this.keys = keys;
    this.pool = pool;
  }

  async createGenesisBlock() {
    assert(!(await this.blockchain.getBlock(0)), 'genesis block already exists');
    console.log('=> Generating new block chain');
    const stakerKeys = PrivateKey.genKeyPair();
    console.log('=> Staker private key:', stakerKeys[1].toWif());

    const genesisTs = new Date();
    const genesisBlock = new Block({
      height: 0,
      previous_hash: Buffer.alloc(32),
      timestamp: genesisTs,
      transactions: [
        new RewardTx({
          timestamp: genesisTs,
          to: stakerKeys[0],
          fee: Asset.EMPTY_GOLD,
          rewards: [ Asset.fromString('1 GOLD') ],
          signature_pairs: []
        }),
        new BondTx({
          timestamp: genesisTs,
          fee: Asset.EMPTY_GOLD,
          minter: this.keys[0],
          staker: stakerKeys[0],
          stake_amt: Asset.fromString('1 GOLD'),
          bond_fee: Asset.fromString('0 GOLD'),
          signature_pairs: []
        })
      ]
    }).sign(this.keys);
    await this.blockchain.addBlock(genesisBlock);
  }

  async produceBlock() {
    const head = this.blockchain.head;
    const bond = (await this.blockchain.indexer.getBond(this.keys[0]))!;
    assert(bond, 'must be a minter to produce a block');

    const block = new Block({
      height: head.height + 1,
      previous_hash: head.calcHash(),
      timestamp: new Date(),
      transactions: [
        ...(await this.pool.popAll()),
        new RewardTx({
          timestamp: new Date(0),
          to: bond.staker,
          fee: Asset.EMPTY_GOLD,
          rewards: [ REWARD_GOLD, REWARD_SILVER ],
          signature_pairs: []
        })
      ]
    }).sign(this.keys);
    await this.blockchain.addBlock(block);
    const len = block.transactions.length;
    console.log(`Produced block at height ${block.height.toString()} with ${len} transaction${len === 1 ? '' : 's'}`);
  }
}
