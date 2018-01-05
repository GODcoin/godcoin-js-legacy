import { Tx, TxPool, TransferTx, RewardTx } from '../transactions';
import { PrivateKey, KeyPair, PublicKey } from '../crypto';
import { Block, SignedBlock } from './block';
import { Asset, AssetSymbol } from '../asset';
import { BigInteger } from 'big-integer';
import * as bigInt from 'big-integer';
import * as assert from 'assert';
export * from './block';

export class Blockchain {

  private readonly blocks: SignedBlock[] = [];
  private readonly pool: TxPool = new TxPool();

  constructor(genesisBlock: SignedBlock) {
    assert(genesisBlock.height.eq(0));
    for (const tx of genesisBlock.transactions) {
      tx.validate();
    }
    this.blocks.push(genesisBlock);
  }

  genBlock(key: PrivateKey|KeyPair): void {
    const txs = this.pool.popAll();
    const block = Block.create(this.getLatestBlock(), txs ? txs : []);
    if (key instanceof PrivateKey) {
      key = {
        privateKey: key,
        publicKey: key.toPub()
      };
    }
    const signed = block.sign(key);
    this.addBlock(signed);
  }

  addBlock(block: SignedBlock): void {
    assert(block.height.eq(this.blocks.length), 'unexpected height');
    assert(this.isBondValid(block.signing_key), 'invalid bond');
    block.validate(this.getLatestBlock());
    this.blocks.push(block);
  }

  getLatestBlock(): SignedBlock {
    return this.getBlock(this.blocks.length - 1);
  }

  getBlock(num: number): SignedBlock {
    return this.blocks[num];
  }

  isBondValid(key: string|PublicKey): boolean {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    return this.blocks[0].signing_key.equals(key);
  }

  getGoldBalance(key: string|PublicKey): Asset {
    return this.getBalance(key, AssetSymbol.GOLD);
  }

  getSilverBalance(key: string|PublicKey): Asset {
    return this.getBalance(key, AssetSymbol.SILVER);
  }

  private getBalance(key: string|PublicKey, symbol: AssetSymbol): Asset {
    if (typeof(key) === 'string') {
      key = PublicKey.fromWif(key);
    }
    let balance: Asset = new Asset(bigInt(0), 0, symbol);
    for (const block of this.blocks) {
      const blockBal = this.getBalanceTxs(key, block.transactions, symbol);
      balance = balance.add(blockBal);
    }
    {
      const txs = this.pool.getAll();
      if (txs) {
        balance = balance.add(this.getBalanceTxs(key, txs, symbol));
      }
    }

    return balance;
  }

  private getBalanceTxs(key: PublicKey, txs: Tx[], symbol: AssetSymbol): Asset {
    let balance: Asset = new Asset(bigInt(0), 0, symbol);
    for (const tx of txs) {
      if (tx instanceof TransferTx) {
        if (tx.data.amount.symbol !== symbol
                    || tx.data.from.equals(tx.data.to)) {
          balance = balance.sub(tx.data.fee);
          continue;
        }
        if (tx.data.from.equals(key)) {
          balance = balance.sub(tx.data.amount).sub(tx.data.fee);
        } else if (tx.data.to.equals(key)) {
          balance = balance.add(tx.data.amount);
        }
      } else if (tx instanceof RewardTx) {
        if (!tx.data.to.equals(key)) {
          continue;
        }
        for (const r of tx.data.rewards) {
          if (r.symbol === symbol) {
            balance = balance.add(r);
          }
        }
      }
    }
    return balance;
  }
}
