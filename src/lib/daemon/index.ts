import { Producer, LocalMinter, TxPool } from '../producer';
import { ClientPeerPool } from './client_peer_pool';
import { Synchronizer } from './synchronizer';
import { Blockchain } from '../blockchain';
import { GODcoinEnv } from '../env';
import { KeyPair } from '../crypto';
import { Server } from './server';
import * as mkdirp from 'mkdirp';
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
  readonly minter?: LocalMinter;

  private readonly txPool: TxPool;
  private readonly sync: Synchronizer;
  private readonly producer: Producer;

  private server?: Server;
  readonly peerPool: ClientPeerPool;

  constructor(readonly opts: DaemonOpts) {
    const dir = path.join(GODcoinEnv.GODCOIN_HOME, 'blockchain', 'data');
    mkdirp.sync(dir);

    this.blockchain = new Blockchain(dir, opts.reindex);
    this.peerPool = new ClientPeerPool();
    this.producer = new Producer(this.blockchain);
    this.sync = new Synchronizer(this.blockchain, this.peerPool, this.producer);

    const isMinter = this.opts.signingKeys !== undefined;
    this.txPool = new TxPool(this.blockchain, isMinter);
    if (isMinter) {
      this.minter = new LocalMinter(this.blockchain, this.txPool, this.opts.signingKeys);
      this.producer.minter = this.minter;
    }
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

    if (this.minter && !(this.blockchain.head || this.opts.peers.length)) {
      await this.minter.createGenesisBlock();
    }

    await this.producer.start();
    if (this.opts.peers.length) {
      for (const peer of this.opts.peers) this.peerPool.addNode(peer);
      await this.peerPool.start();

      await this.sync.start();
    }
    await this.producer.startTimer();

    if (this.opts.listen) {
      this.server = new Server({
        blockchain: this.blockchain,
        pool: this.txPool,
        bindAddress: this.opts.bind,
        port: this.opts.port
      });
      this.server.start();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.producer.stop();
    await this.sync.stop();
    await this.peerPool.stop();
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }

    await this.blockchain.stop();
  }
}
