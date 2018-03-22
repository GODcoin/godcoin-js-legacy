import { Blockchain, Block, ChainIndex, ChainStore } from '../blockchain';
import { RewardTx, TxType } from '../transactions';
import { KeyPair, PrivateKey } from '../crypto';
import { getAppDir } from './util';
import { Asset } from '../asset';
import * as assert from 'assert';
import * as Long from 'long';
import * as path from 'path';

export interface DaemonOpts {
  signingKeys?: KeyPair;
  regtest?: boolean;
  createGenesisBlock?: boolean;
}

export class Daemon {

  readonly blockchain: Blockchain;

  constructor(readonly opts: DaemonOpts) {
    this.opts = opts;
    const index = new ChainIndex(path.join(getAppDir(), 'blkindex'));
    const store = new ChainStore(getAppDir(), index);
    this.blockchain = new Blockchain(store, index);
  }

  async start(): Promise<void> {
    await this.blockchain.start();
    if (!(await this.blockchain.getBlock(0))) {
      if (this.opts.createGenesisBlock) {
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
              to: this.opts.signingKeys!.publicKey,
              rewards: [ Asset.fromString('1 GOLD') ],
              signatures: []
            })
          ]
        }).sign(this.opts.signingKeys!);
        this.blockchain.addBlock(genesisBlock);
      }
      // TODO: synchronize with another peer
      throw new Error('Missing genesis block');
    }
  }

  async stop(): Promise<void> {
    await this.blockchain.stop();
  }
}
