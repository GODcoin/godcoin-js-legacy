import { Blockchain, Block, ChainStore } from '../blockchain';
import { RewardTx, TxType } from '../transactions';
import { KeyPair, PrivateKey } from '../crypto';
import { Asset, AssetSymbol } from '../asset';
import { Minter, TxPool } from '../producer';
import * as bigInt from 'big-integer';
import { Indexer } from '../indexer';
import { GODcoinEnv } from '../env';
import { Server } from './server';
import * as assert from 'assert';
import * as mkdirp from 'mkdirp';
import * as Long from 'long';
import * as path from 'path';

export interface DaemonOpts {
  signingKeys: KeyPair;
  reindex: boolean;
  peers: string[];
  listen: boolean;
  bind: string;
  port: number;
}

export class Daemon {

  readonly blockchain: Blockchain;
  readonly pool: TxPool;
  private server?: Server;
  private minter?: Minter;

  constructor(readonly opts: DaemonOpts) {
    this.opts = opts;

    const dir = path.join(GODcoinEnv.GODCOIN_HOME, 'blockchain', 'data');
    mkdirp.sync(dir);

    this.blockchain = new Blockchain(dir, opts.reindex);
    this.pool = new TxPool(this.blockchain);
  }

  async start(): Promise<void> {
    await this.blockchain.start();

    if (this.blockchain.head) {
      const height = this.blockchain.head.height.toString();
      console.log(`Using existing blockchain at height ${height}`);
    }

    if (this.opts.signingKeys) {
      this.minter = new Minter(this.blockchain, this.pool, this.opts.signingKeys);
      if (!this.blockchain.head) {
        await this.minter.createGenesisBlock();
      }
    }

    if (this.opts.listen) {
      this.server = new Server({
        blockchain: this.blockchain,
        pool: this.pool,
        minter: this.minter,
        bindAddress: this.opts.bind,
        port: this.opts.port
      });
      this.server.start();
    }

    if (this.minter) {
      this.minter.start();
    }
  }

  async stop(): Promise<void> {
    await this.blockchain.stop();
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
    if (this.minter) {
      this.minter.stop();
      this.minter = undefined;
    }
  }
}
