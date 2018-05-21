import { Blockchain, Block, ChainStore, SignedBlock } from '../blockchain';
import { ClientPeerPool, EndOfClients } from './client_peer_pool';
import { RewardTx, TxType } from '../transactions';
import { LocalMinter, TxPool } from '../producer';
import { KeyPair, PrivateKey } from '../crypto';
import { Asset, AssetSymbol } from '../asset';
import { Synchronizer } from './synchronizer';
import * as bigInt from 'big-integer';
import { Indexer } from '../indexer';
import { GODcoinEnv } from '../env';
import { Server } from './server';
import * as assert from 'assert';
import * as mkdirp from 'mkdirp';
import { Lock } from '../lock';
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

  private running = false;

  readonly blockchain: Blockchain;
  private sync: Synchronizer;
  private minter?: LocalMinter;

  private server?: Server;
  readonly peerPool: ClientPeerPool;

  constructor(readonly opts: DaemonOpts) {
    const dir = path.join(GODcoinEnv.GODCOIN_HOME, 'blockchain', 'data');
    mkdirp.sync(dir);

    this.blockchain = new Blockchain(dir, opts.reindex);
    this.peerPool = new ClientPeerPool();
    this.sync = new Synchronizer(this.blockchain, this.peerPool);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.blockchain.start();
    if (this.blockchain.head) {
      const height = this.blockchain.head.height.toString();
      console.log(`Using existing blockchain at height ${height}`);
    } else {
      console.log('Block log is empty or missing');
    }

    if (this.opts.peers.length) {
      for (const peer of this.opts.peers) this.peerPool.addNode(peer);
      await this.peerPool.start();

      await this.sync.start();
    }

    const txPool = new TxPool(this.blockchain, this.opts.signingKeys !== undefined);
    if (this.opts.signingKeys) {
      this.minter = new LocalMinter(this.blockchain, txPool, this.opts.signingKeys);
      if (!(this.blockchain.head || this.opts.peers.length)) {
        await this.minter.createGenesisBlock();
      }
    }

    if (this.opts.listen) {
      this.server = new Server({
        blockchain: this.blockchain,
        pool: txPool,
        bindAddress: this.opts.bind,
        port: this.opts.port
      });
      this.server.start();
    }

    if (this.minter) this.minter.start();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.sync.stop();
    await this.peerPool.stop();
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
