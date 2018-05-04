import { Blockchain, Block, ChainStore } from '../blockchain';
import { ClientPeerPool } from './client_peer_pool';
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
  readonly txPool: TxPool;
  readonly peerPool: ClientPeerPool;
  private server?: Server;
  private minter?: Minter;

  constructor(readonly opts: DaemonOpts) {
    const dir = path.join(GODcoinEnv.GODCOIN_HOME, 'blockchain', 'data');
    mkdirp.sync(dir);

    this.blockchain = new Blockchain(dir, opts.reindex);
    this.txPool = new TxPool(this.blockchain, this.opts.signingKeys !== undefined);
    this.peerPool = new ClientPeerPool();
  }

  async start(): Promise<void> {
    await this.blockchain.start();

    if (this.blockchain.head) {
      const height = this.blockchain.head.height.toString();
      console.log(`Using existing blockchain at height ${height}`);
    }

    if (this.opts.peers.length) {
      for (const peer of this.opts.peers) this.peerPool.addNode(peer);
      await this.peerPool.start();
    }

    if (this.opts.signingKeys) {
      this.minter = new Minter(this.blockchain, this.txPool, this.opts.signingKeys);
      if (!(this.blockchain.head || this.opts.peers.length)) {
        await this.minter.createGenesisBlock();
      }
    }

    if (this.opts.listen) {
      this.server = new Server({
        blockchain: this.blockchain,
        pool: this.txPool,
        bindAddress: this.opts.bind,
        port: this.opts.port
      });
      this.server.start();
    }

    if (this.minter) this.minter.start();
  }

  async stop(): Promise<void> {
    this.peerPool.stop();
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }

    await this.blockchain.stop();
    if (this.minter) {
      this.minter.stop();
      this.minter = undefined;
    }
  }
}
