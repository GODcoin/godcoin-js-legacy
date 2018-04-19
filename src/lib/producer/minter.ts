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

        // Update indexed balances
        for (const tx of block.transactions) {
          if (tx instanceof TransferTx) {
            const fromBal = await this.blockchain.getBalance(tx.data.from);
            const toBal = await this.blockchain.getBalance(tx.data.to);

            if (tx.data.amount.symbol === AssetSymbol.GOLD) {
              fromBal[0] = fromBal[0].sub(tx.data.amount).sub(tx.data.fee);
              toBal[0] = toBal[0].add(tx.data.amount);
            } else if (tx.data.amount.symbol === AssetSymbol.SILVER) {
              fromBal[1] = fromBal[1].sub(tx.data.amount).sub(tx.data.fee);
              toBal[1] = toBal[1].add(tx.data.amount);
            } else {
              throw new Error('unhandled symbol: ' + tx.data.amount.symbol);
            }
            await this.blockchain.setBalance(tx.data.from, fromBal);
            await this.blockchain.setBalance(tx.data.to, toBal);
          } else if (tx instanceof RewardTx) {
            const toBal = await this.blockchain.getBalance(tx.data.to);
            for (const reward of tx.data.rewards) {
              if (reward.symbol === AssetSymbol.GOLD) {
                toBal[0] = toBal[0].add(reward);
              } else if (reward.symbol === AssetSymbol.SILVER) {
                toBal[1] = toBal[1].add(reward);
              } else {
                throw new Error('unhandled symbol: ' + reward.symbol);
              }
            }
            await this.blockchain.setBalance(tx.data.to, toBal);
          }
        }

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
