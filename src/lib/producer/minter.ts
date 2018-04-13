import { Blockchain, SignedBlock, Block } from '../blockchain';
import { RewardTx, TxType } from '../transactions';
import * as bigInt from 'big-integer';
import { KeyPair } from '../crypto';
import * as Long from 'long';
import { Asset, AssetSymbol } from '..';

export class Minter {

  private readonly blockchain: Blockchain;
  private readonly keys: KeyPair;

  private timer?: NodeJS.Timer;

  constructor(blockchain: Blockchain, keys: KeyPair) {
    this.blockchain = blockchain;
    this.keys = keys;
  }

  start() {
    if (this.timer) return;
    console.log('Started block production');
    this.timer = setInterval(async () => {
      try {
        const head = this.blockchain.getLatestBlock();
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
            })
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
