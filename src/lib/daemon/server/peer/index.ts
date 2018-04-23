import { ApiError, ApiErrorCode, check } from './api_error';
import { Blockchain } from '../../../blockchain';
import { PublicKey } from '../../../crypto';
import { Minter } from '../../../producer';
import { PeerNet } from './net';

export * from './net';

export interface PeerOptions {
  net: PeerNet;
  blockchain: Blockchain;
  minter?: Minter;
}

export class Peer {

  private readonly blockchain: Blockchain;
  private readonly minter?: Minter;
  private readonly net: PeerNet;

  constructor(opts: PeerOptions) {
    this.blockchain = opts.blockchain;
    this.minter = opts.minter;
    this.net = opts.net;
  }

  init() {
    this.net.init(this.processMessage.bind(this));
  }

  private async processMessage(map: any): Promise<any> {
    const method = map.method;
    switch (method) {
      case 'block_proposal': {
        // TODO: handle minter block proposals
        return;
      }
      case 'broadcast': {
        const tx: Buffer = map.tx;
        check(tx, ApiErrorCode.INVALID_PARAMS, 'missing tx');
        check(tx instanceof Buffer, ApiErrorCode.INVALID_PARAMS, 'tx not a buffer');

        let refBlock!: Long;
        let refTxPos!: number;
        if (this.minter) {
          const data = await this.minter.pool.push(tx);
          refBlock = data[0];
          refTxPos = data[1];
          return {
            ref_block: refBlock.toString(),
            ref_tx_pos: refTxPos
          };
        }
        // TODO: broadcast to all clients
        return;
      }
      case 'get_block': {
        const height = map.height;
        check(typeof(height) === 'number', ApiErrorCode.INVALID_PARAMS, 'height must be a number');
        check(height >= 0, ApiErrorCode.INVALID_PARAMS, 'height must be >= 0');
        const block = await this.blockchain.getBlock(height);
        if (block) {
          return {
            block: block.fullySerialize()
          };
        }
        return;
      }
      case 'get_balance': {
        const address = map.address;
        check(typeof(address) === 'string', ApiErrorCode.INVALID_PARAMS, 'address must be a string');
        const balance = await this.blockchain.getBalance(PublicKey.fromWif(address));
        return {
          balance: [
            balance[0].toString(),
            balance[1].toString()
          ]
        };
      }
      default:
        throw new ApiError(ApiErrorCode.UNKNOWN_METHOD, 'unknown method');
    }
  }
}
