import { DisconnectedError, ApiError, ApiErrorCode, check } from '../../net';
import { Blockchain, SignedBlock } from '../../blockchain';
import { LocalMinter, TxPool } from '../../producer';
import { PublicKey } from '../../crypto';
import { PeerNet } from './net';

export * from './net';

export interface PeerOptions {
  blockchain: Blockchain;
  pool: TxPool;
  minter?: LocalMinter;
  net: PeerNet;
}

export class Peer {

  private readonly blockchain: Blockchain;
  private readonly pool: TxPool;
  private readonly net: PeerNet;

  private blockHandler?: (block: SignedBlock) => void;

  constructor(opts: PeerOptions) {
    this.blockchain = opts.blockchain;
    this.pool = opts.pool;
    this.net = opts.net;
  }

  init() {
    this.net.init(this.processMessage.bind(this));
  }

  private async processMessage(map: any): Promise<any> {
    const method = map.method;
    switch (method) {
      case 'broadcast': {
        const tx: Buffer = map.tx;
        check(tx, ApiErrorCode.INVALID_PARAMS, 'missing tx');
        check(tx instanceof Buffer, ApiErrorCode.INVALID_PARAMS, 'tx not a buffer');

        let refBlock!: Long;
        let refTxPos!: number;
        if (this.pool.writable) {
          const data = await this.pool.push(tx);
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
      case 'get_properties': {
        return {
          block_height: this.blockchain.head.height.toString(),
          network_fee: [
            this.blockchain.networkFee[0].toString(),
            this.blockchain.networkFee[1].toString()
          ]
        };
      }
      case 'get_block': {
        const height: number = map.height;
        check(typeof(height) === 'number', ApiErrorCode.INVALID_PARAMS, 'height must be a number');
        check(height >= 0, ApiErrorCode.INVALID_PARAMS, 'height must be >= 0');
        const block = await this.blockchain.getBlock(height);
        if (block) {
          return {
            block: block.fullySerialize().toBuffer()
          };
        }
        return;
      }
      case 'get_block_range': {
        const min: number = map.min_height;
        const max: number = map.max_height;
        check(typeof(min) === 'number', ApiErrorCode.INVALID_PARAMS, 'min_height must be a number');
        check(typeof(max) === 'number', ApiErrorCode.INVALID_PARAMS, 'max_height must be a number');
        check(min >= 0, ApiErrorCode.INVALID_PARAMS, 'min_height must be >= 0');
        check(max >= min, ApiErrorCode.INVALID_PARAMS, 'max_height must be >= min_height');
        check(max - min <= 100, ApiErrorCode.INVALID_PARAMS, 'range retrieval must be <= 100 blocks');

        const blocks: ArrayBuffer[] = [];
        let outsideRange = false;
        for (let i = min; i <= max; ++i) {
          const block = await this.blockchain.getBlock(i);
          if (block) {
            blocks.push(block.fullySerialize().toBuffer());
          } else {
            outsideRange = true;
            break;
          }
        }
        return {
          range_outside_height: outsideRange,
          blocks
        };
      }
      case 'get_total_fee': {
        const address: string = map.address;
        check(typeof(address) === 'string', ApiErrorCode.INVALID_PARAMS, 'address must be a string');
        const wif = PublicKey.fromWif(address);
        const fee = await this.pool.getTotalFee(wif);
        return {
          fee: [
            fee[0].toString(),
            fee[1].toString()
          ]
        };
      }
      case 'get_balance': {
        const address: string = map.address;
        check(typeof(address) === 'string', ApiErrorCode.INVALID_PARAMS, 'address must be a string');
        const balance = await this.pool.getBalance(PublicKey.fromWif(address));
        return {
          balance: [
            balance[0].toString(),
            balance[1].toString()
          ]
        };
      }
      case 'subscribe_block': {
        check(!this.blockHandler, ApiErrorCode.MISC, 'already subscribed');
        const id = map.id;

        this.blockHandler = async (block: SignedBlock) => {
          try {
            await this.net.sendEvent('block', {
              block: block.fullySerialize().toBuffer()
            });
          } catch (e) {
            if (e instanceof DisconnectedError) {
              this.blockchain.removeListener('block', this.blockHandler!);
              this.blockHandler = undefined;
            } else {
              console.log(`[${this.net.ip}] Failed to push block to client`);
            }
          }
        };
        setImmediate(() => {
          this.blockchain.on('block', this.blockHandler!);
        });
        return {
          block: this.blockchain.head.fullySerialize().toBuffer()
        };
      }
      default:
        throw new ApiError(ApiErrorCode.UNKNOWN_METHOD, 'unknown method');
    }
  }
}
