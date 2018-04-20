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
  private timer?: NodeJS.Timer;

  readonly pool: TxPool;

  constructor(blockchain: Blockchain, keys: KeyPair) {
    this.blockchain = blockchain;
    this.keys = keys;
    this.pool = new TxPool(this.blockchain);
  }

  start() {
    if (this.timer) return;
    console.log('Started block production');
    this.timer = setInterval(async () => {
      try {
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
      } catch (e) {
        console.log('Failed to produce block', e);
      }
    }, 3000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
