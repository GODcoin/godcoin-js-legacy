import { Blockchain, Block, ChainStore } from '../blockchain';
import { RewardTx, TxType } from '../transactions';
import { KeyPair, PrivateKey } from '../crypto';
import { Minter } from '../producer';
import { Indexer } from '../indexer';
import { getAppDir } from './util';
import { Server } from './server';
import { Asset } from '../asset';
import * as assert from 'assert';
import * as mkdirp from 'mkdirp';
import * as Long from 'long';
import * as path from 'path';
export * from './util';

export interface DaemonOpts {
  signingKeys: KeyPair;
  regtest: boolean;
  listen: boolean;
  bind: string;
  port: number;
}

export class Daemon {

  readonly blockchain: Blockchain;
  private server?: Server;
  private minter?: Minter;

  constructor(readonly opts: DaemonOpts) {
    this.opts = opts;

    const dir = path.join(getAppDir(), 'blockchain', 'data');
    mkdirp.sync(dir);

    const index = new Indexer(path.join(dir, 'index'));
    const store = new ChainStore(path.join(dir, 'blklog'), index);
    this.blockchain = new Blockchain(store, index);
  }

  async start(): Promise<void> {
    await this.blockchain.start();
    if (this.blockchain.store.blockHead) {
      const height = this.blockchain.store.blockHead.height.toString();
      console.log(`Using existing blockchain at height ${height}`);
    } else {
      // TODO: synchronize p2p network
      console.log('Generating new block chain');
      assert(this.opts.signingKeys, 'failed to create genesis block: missing signing keys');
      assert(!(await this.blockchain.getBlock(0)), 'genesis block already exists');
      const genesisTs = new Date();
      const genesisBlock = new Block({
        height: Long.fromNumber(0, true),
        previous_hash: undefined as any,
        timestamp: genesisTs,
        transactions: [
          new RewardTx({
            type: TxType.REWARD,
            timestamp: genesisTs,
            to: this.opts.signingKeys.publicKey,
            rewards: [ Asset.fromString('1 GOLD') ],
            signatures: []
          })
        ]
      }).sign(this.opts.signingKeys);
      await this.blockchain.addBlock(genesisBlock);
    }

    if (this.opts.listen) {
      this.server = new Server(this.opts.bind, this.opts.port);
      this.server.start();
    }

    if (this.opts.signingKeys) {
      this.minter = new Minter(this.blockchain, this.opts.signingKeys);
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
