import * as assert from 'assert';
import * as Long from 'long';
import { Asset, AssetSymbol, EMPTY_GOLD } from '../asset';
import { Block, Blockchain } from '../blockchain';
import { generateKeyPair, KeyPair } from '../crypto';
import { BondTx, RewardTx, TxType } from '../transactions';
import { TxPool } from './tx_pool';

const REWARD_GOLD = new Asset(BigInt(1), 0, AssetSymbol.GOLD);
const REWARD_SILVER = new Asset(BigInt(100), 0, AssetSymbol.SILVER);

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
    const stakerKeys = generateKeyPair();
    console.log('=> Staker private key:', stakerKeys.privateKey.toString());

    const genesisTs = new Date();
    const genesisBlock = new Block({
      height: Long.fromNumber(0, true),
      previous_hash: undefined as any,
      timestamp: genesisTs,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          timestamp: genesisTs,
          to: stakerKeys.publicKey,
          fee: EMPTY_GOLD,
          rewards: [ Asset.fromString('1 GOLD') ],
          signature_pairs: []
        }),
        new BondTx({
          type: TxType.BOND,
          timestamp: genesisTs,
          fee: EMPTY_GOLD,
          minter: this.keys.publicKey,
          staker: stakerKeys.publicKey,
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

    const bond = await this.blockchain.indexer.getBond(head.signature_pair.public_key);
    assert(bond, 'must be a minter to produce a block');

    const block = new Block({
      height: head.height.add(1),
      previous_hash: head.getHash(),
      timestamp: new Date(),
      transactions: [
        ...(await this.pool.popAll()),
        new RewardTx({
          type: TxType.REWARD,
          timestamp: new Date(0),
          to: bond!.staker,
          fee: EMPTY_GOLD,
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
