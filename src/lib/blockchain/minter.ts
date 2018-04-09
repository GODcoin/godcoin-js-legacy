import { Blockchain } from './blockchain';
import { KeyPair } from '../crypto';
import { Block, SignedBlock } from './block';
import * as Long from 'long';

export class Minter {


  private readonly blockchain: Blockchain;
  private readonly keys: KeyPair;

  private timer?: NodeJS.Timer;
  private headBlock?: SignedBlock;

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
        const block = new Block({
          height: head.height.add(1),
          previous_hash: head.getHash(),
          timestamp: new Date(),
          transactions: []
        }).sign(this.keys);
        await this.blockchain.addBlock(block);
        this.headBlock = block;

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
