import { RewardTx, TxType } from '../transactions';
import { Blockchain, Block } from '../blockchain';
import { KeyPair, PrivateKey } from '../crypto';
import { Asset } from '../asset';
import * as Long from 'long';

export interface DaemonOpts {
  signingKeys: KeyPair;
  regtest: boolean;
}

export class Daemon {

  readonly signingKeys: KeyPair;
  readonly regtest: boolean;

  constructor(opts: DaemonOpts) {
    this.signingKeys = opts.signingKeys;
    this.regtest = opts.regtest;
  }

  start(): void {
    const genesisTs = new Date();
    const genesisBlock = new Block({
      height: Long.fromNumber(0, true),
      timestamp: genesisTs,
      previous_hash: '',
      transactions: [
        new RewardTx({
          type: TxType.REWARD,
          timestamp: genesisTs,
          to: this.signingKeys.publicKey,
          rewards: [
            Asset.fromString('1 GOLD'),
            Asset.fromString('1 SILVER')
          ],
          signatures: []
        })
      ]
    }).sign(this.signingKeys);

    const chain = new Blockchain(genesisBlock);
    console.log(genesisBlock.toString());
    if (!this.regtest) {
      setInterval(() => {
        console.log('Creating a new block');
        chain.genBlock(this.signingKeys);
        console.log(chain.getLatestBlock().toString());
        console.log(chain.getGoldBalance(this.signingKeys.publicKey).toString());
      }, 10000);
    }
  }

}
