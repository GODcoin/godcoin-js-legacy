import { Blockchain } from '../../../blockchain';
import * as ByteBuffer from 'bytebuffer';
import * as WebSocket from 'ws';
import * as cbor from 'cbor';

export interface PeerOptions {
  ws: WebSocket;
  ip: string;
  blockchain: Blockchain;
}

export class Peer {

  private readonly ws: WebSocket;
  private readonly ip: string;
  private readonly blockchain: Blockchain;

  constructor(opts: PeerOptions) {
    this.ws = opts.ws;
    this.ip = opts.ip;
    this.blockchain = opts.blockchain;
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
        } else if (data instanceof Buffer) {
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
        // TODO: handle transaction broadcasts
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
        const balance = await this.blockchain.getBalance(address);
        await this.send(cbor.encode({
          id,
          balance: {
            gold: balance.gold.toString(),
            silver: balance.silver.toString()
          }
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

export enum WsCloseCode {
  NORMAL = 1000,
  GOING_AWAY = 1001,
  UNSUPPORTED_DATA = 1003,
  POLICY_VIOLATION = 1008
}

enum ApiErrorCode {
  MISC = 1000,
  UNKNOWN_METHOD = 1001,
  INVALID_PARAMS = 1002
}

class ApiError extends Error {

  constructor(readonly code: ApiErrorCode, msg: string) {
    super(msg);
  }
}

function check(cond: any, code: ApiErrorCode, msg: string) {
  if (!cond) throw new ApiError(code, msg);
}

function isNullOrUndefined(val: any) {
  return val === null || val === undefined;
}
