import { RewardTx, TxType, TransferTx, Tx } from '../transactions';
import { Blockchain, SignedBlock, Block } from '../blockchain';
import { KeyPair, PublicKey } from '../crypto';
import { Asset, AssetSymbol } from '../asset';
import * as bigInt from 'big-integer';
import { TxPool } from './tx_pool';
import * as assert from 'assert';
import * as Long from 'long';

export class Minter {

  private readonly blockchain: Blockchain;
  private readonly keys: KeyPair;
  private running = false;
  private timer?: NodeJS.Timer;

  readonly pool: TxPool;

  constructor(blockchain: Blockchain, pool: TxPool, keys: KeyPair) {
    this.blockchain = blockchain;
    this.keys = keys;
    this.pool = pool;
  }

  start() {
    if (this.running) return;
    console.log('Started block production');
    this.running = true;
    this.startTimer();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async createGenesisBlock() {
    assert(!(await this.blockchain.getBlock(0)), 'genesis block already exists');
    console.log('Generating new block chain');
    const genesisTs = new Date();
    const genesisBlock = new Block({
      height: Long.fromNumber(0, true),
      previous_hash: undefined as any,
      timestamp: genesisTs,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          timestamp: genesisTs,
          to: this.keys.publicKey,
          fee: new Asset(bigInt(0), 0, AssetSymbol.GOLD),
          rewards: [ Asset.fromString('1 GOLD') ],
          signatures: []
        })
      ]
    }).sign(this.keys);
    await this.blockchain.addBlock(genesisBlock);
  }

  private startTimer() {
    this.timer = setTimeout(async () => {
      if (!this.running) return;
      try {
        await this.produceBlock();
      } catch (e) {
        console.log('Failed to produce block', e);
      }
      this.startTimer();
    }, 3000);
  }

  private async produceBlock() {
    const head = this.blockchain.head;
    const ts = new Date();
    const block = new Block({
      height: head.height.add(1),
      previous_hash: head.getHash(),
      timestamp: ts,
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          timestamp: ts,
          to: head.signing_key,
          fee: new Asset(bigInt(0), 0, AssetSymbol.GOLD),
          rewards: [
            new Asset(bigInt(1), 0, AssetSymbol.GOLD),
            new Asset(bigInt(100), 0, AssetSymbol.SILVER)
          ],
          signatures: []
        }),
        ...(await this.pool.popAll())
      ]
    }).sign(this.keys);
    await this.blockchain.addBlock(block);
    const len = block.transactions.length;
    console.log(`Produced block at height ${block.height.toString()} with ${len} transaction${len === 1 ? '' : 's'}`);
  }
}
