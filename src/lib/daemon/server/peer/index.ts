import { WsCloseCode, ApiError, ApiErrorCode, check } from './api_error';
import { Tx, deserialize } from '../../../transactions';
import { Blockchain } from '../../../blockchain';
import { PublicKey } from '../../../crypto';
import { Minter } from '../../../producer';
import * as ByteBuffer from 'bytebuffer';
import * as WebSocket from 'uws';
import * as cbor from 'cbor';

export interface PeerOptions {
  ws: WebSocket;
  ip: string;
  blockchain: Blockchain;
  minter?: Minter;
}

export class Peer {

  private readonly ws: WebSocket;
  private readonly ip: string;
  private readonly blockchain: Blockchain;
  private readonly minter?: Minter;

  constructor(opts: PeerOptions) {
    this.ws = opts.ws;
    this.ip = opts.ip;
    this.blockchain = opts.blockchain;
    this.minter = opts.minter;
  }

  init() {
    this.ws.on('close', () => {
      console.log(`[${this.ip}] Peer has disconnected`);
      this.ws.removeAllListeners();
    });

    this.ws.on('message', async data => {
      try {
        if (typeof(data) === 'string') {
          this.close(WsCloseCode.UNSUPPORTED_DATA, 'text not supported');
        } else if (data instanceof ArrayBuffer) {
          data = Buffer.from(data);
          const map = cbor.decode(data);
          const id = map.id;
          if (typeof(id) !== 'number') {
            this.close(WsCloseCode.POLICY_VIOLATION, 'id must be a number');
            return;
          }
          try {
            await this.processMessage(id, map);
          } catch (e) {
            if (e instanceof ApiError) {
              await this.send(cbor.encode({
                id,
                error: e.code,
                message: e.message
              }));
            } else {
              await this.send(cbor.encode({
                id,
                error: ApiErrorCode.MISC,
                message: e.message
              }));
            }
          }
        }
      } catch (e) {
        console.log(`[${this.ip}] Failed to process message`, e);
      }
    });

    this.ws.on('ping', () => {
      this.ws.pong();
    });
  }

  close(code: WsCloseCode = 1000, reason?: string): void {
    this.ws.close(code, reason);
  }

  private async processMessage(id: number, map: any): Promise<void> {
    const method = map.method;
    switch (method) {
      case 'block_proposal': {
        // TODO: handle minter block proposals
        await this.send(cbor.encode({ id }));
        break;
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

          await this.send(cbor.encode({
            id,
            ref_block: refBlock.toString(),
            ref_tx_pos: refTxPos
          }));
          break;
        }
        // TODO: broadcast to all clients
        await this.send(cbor.encode({ id }));
        break;
      }
      case 'get_block': {
        const height = map.height;
        check(typeof(height) === 'number', ApiErrorCode.INVALID_PARAMS, 'height must be a number');
        check(height >= 0, ApiErrorCode.INVALID_PARAMS, 'height must be >= 0');
        const block = await this.blockchain.getBlock(height);
        if (block) {
          await this.send(cbor.encode({
            id,
            block: block.fullySerialize()
          }));
        } else {
          await this.send(cbor.encode({ id }));
        }
        break;
      }
      case 'get_balance': {
        const address = map.address;
        check(typeof(address) === 'string', ApiErrorCode.INVALID_PARAMS, 'address must be a string');
        const balance = await this.blockchain.getBalance(PublicKey.fromWif(address));
        await this.send(cbor.encode({
          id,
          balance: [
            balance[0].toString(),
            balance[1].toString()
          ]
        }));
        break;
      }
      default:
        throw new ApiError(ApiErrorCode.UNKNOWN_METHOD, 'unknown method');
    }
  }

  private send(data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws.send(data, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

function isNullOrUndefined(val: any) {
  return val === null || val === undefined;
}
