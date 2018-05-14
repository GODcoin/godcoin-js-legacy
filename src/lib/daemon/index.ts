import { Blockchain, Block, ChainStore, SignedBlock } from '../blockchain';
import { ClientPeerPool, EndOfClients } from './client_peer_pool';
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

  readonly blockchain: Blockchain;
  readonly txPool: TxPool;
  readonly peerPool: ClientPeerPool;
  private running = false;
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

      const lock = new Lock();
      let blocks: SignedBlock[]|undefined = [];
      await this.peerPool.subscribeBlock(async block => {
        await lock.lock();
        try {
          if (blocks) {
            blocks.push(block);
          } else {
            const height = block.height.toString();
            const len = block.transactions.length;
            await this.blockchain.addBlock(block);
            console.log(`Received block at height ${height} with ${len} transaction${len === 1 ? '' : 's'}`);
          }
        } catch (e) {
          console.log('Failed to process block during subscription', e);
        } finally {
          lock.unlock();
        }
      });

      const sync = async () => {
        try {
          await lock.lock();
          await this.synchronizeChain();
          if (blocks) {
            for (const b of blocks) {
              if (b.height.gt(this.blockchain.head.height)) {
                await this.blockchain.addBlock(b);
              }
            }
            blocks = undefined;
          }
        } catch (e) {
          console.log('Failed to synchronize blockchain');
        } finally {
          lock.unlock();
        }
      };

      this.peerPool.on('open', async () => {
        console.log('Resuming synchronization...');
        await sync();
        console.log('Synchronized at height', this.blockchain.head.height.toString());
      });

      this.peerPool.on('close', async () => {
        try {
          await lock.lock();
          console.log('Synchronization paused until more clients are connected in the peer pool');
          blocks = [];
        } finally {
          lock.unlock();
        }
      });

      await sync();
      const height = this.blockchain.head.height;
      console.log('Synchronization completed at height', height.toString());
      lock.unlock();
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
    this.running = false;
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

  private async synchronizeChain(): Promise<void> {
    let height = this.blockchain.head ? this.blockchain.head.height : undefined;
    let batch = this.blockchain.prepareBatch();
    while (this.running) {
      try {
        const min = height ? height.add(1) : Long.fromNumber(0, true);
        const max = height ? height.add(100) : min.add(100);
        const range = await this.peerPool.getBlockRange(min.toNumber(), max.toNumber());
        height = max;

        if (range.blocks.length) {
          for (const block of range.blocks) {
            if (this.running) {
              if (this.blockchain.head) block.validate(this.blockchain.head);
              await batch.index(block);
            }
          }
        }
        if (range.range_outside_height) break;
      } catch (e) {
        if (e instanceof EndOfClients) {
          await new Promise(r => setTimeout(r, 3000).unref());
          continue;
        }
        await batch.flush();
        throw e;
      }
    }
    await batch.flush();
    await this.blockchain.reload();
  }

}
