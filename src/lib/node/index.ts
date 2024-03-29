import { KeyPair } from 'godcoin-neon';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import { Blockchain } from '../blockchain';
import { LocalMinter, Producer, TxPool } from '../producer';
import { ClientPeerPool } from './client_peer_pool';
import { Server } from './server';
import { Synchronizer } from './synchronizer';

export interface NodeOpts {
  homeDir: string;
  signingKeys: KeyPair;
  reindex: boolean;
  peers: string[];
  listen: boolean;
  bind: string;
  port: number;
}

export class Node {

  readonly blockchain: Blockchain;
  readonly peerPool: ClientPeerPool;
  readonly minter?: LocalMinter;

  private running = false;
  private readonly txPool: TxPool;
  private readonly sync: Synchronizer;
  private readonly producer: Producer;
  private server?: Server;

  constructor(readonly opts: NodeOpts) {
    const dir = path.join(opts.homeDir, 'blockchain', 'data');
    mkdirp.sync(dir);

    this.blockchain = new Blockchain(dir, opts.reindex);
    this.peerPool = new ClientPeerPool();

    this.txPool = new TxPool(this.blockchain);
    this.producer = new Producer(this.blockchain, this.txPool);
    this.sync = new Synchronizer(this.blockchain, this.peerPool, this.txPool, this.producer);
    const isMinter = this.opts.signingKeys !== undefined;
    if (isMinter) {
      this.minter = new LocalMinter(this.blockchain, this.txPool, this.opts.signingKeys);
      this.producer.minter = this.minter;
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
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

      await this.initPeerPool();
      await this.sync.start();
      await this.producer.start();

      if (this.opts.listen) {
        this.server = new Server({
          blockchain: this.blockchain,
          pool: this.txPool,
          bindAddress: this.opts.bind,
          port: this.opts.port
        });
        this.server.start(this.sync);
      }
    } catch (e) {
      await this.stop();
      throw e;
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

  private async initPeerPool() {
    for (const peer of this.opts.peers) {
      this.peerPool.addNode({
        blockchain: this.blockchain,
        pool: this.txPool
      }, peer);
    }
    await this.peerPool.start();
    this.peerPool.subscribeBlock(this.sync.handleBlock.bind(this.sync));
    this.peerPool.subscribeTx(this.sync.handleTx.bind(this.sync));

    this.peerPool.on('open', () => {
      if (this.sync.isComplete) {
        this.producer.start(true).catch(e => {
          console.log('Failed to start the producer after resuming the peer pool', e);
        });

        this.sync.resume().catch(e => {
          console.log('Failed to resume the synchronizer', e);
        });
      }
    });

    this.peerPool.on('close', () => {
      if (this.server && this.server.clientCount > 0) return;
      this.sync.pause();
      this.producer.stop().catch(e => {
        console.log('Failed to stop the producer after stopping the peer pool', e);
      });
    });
  }
}
