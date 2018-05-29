import {
  DisconnectedError,
  ApiErrorCode,
  WsCloseCode,
  ApiError,
  check
} from './errors';
import { Blockchain, SignedBlock } from '../blockchain';
import { TxPool, LocalMinter } from '../producer';
import { EventEmitter } from 'events';
import { PublicKey } from '../crypto';
import * as WebSocket from 'uws';
import * as borc from 'borc';

export interface NetOpts {
  nodeUrl: string;
  blockchain: Blockchain;
  minter?: LocalMinter;
  pool: TxPool;
}

export abstract class Net extends EventEmitter {

  private _ws?: WebSocket;

  private requests: {[key: number]: PromiseLike} = {};
  private id = 0;

  private blockHandler?: (block: SignedBlock) => void;

  constructor(readonly opts: NetOpts) {
    super();
  }

  get ws(): WebSocket|undefined {
    return this._ws;
  }

  set ws(socket: WebSocket|undefined) {
    if (socket) {
      // Server side socket is already open
      if (socket.readyState !== WebSocket.OPEN) socket.on('open', this.onOpen.bind(this));
      socket.on('close', this.onClose.bind(this));
      socket.on('message', this.onMessage.bind(this));
      socket.on('ping', this.onPing.bind(this));
      socket.on('error', this.onError.bind(this));
    } else if (this._ws) {
      this._ws.close();
      this._ws.removeAllListeners();
    }
    this._ws = socket;
  }

  get isOpen(): boolean {
    return this._ws !== undefined && this._ws.readyState === WebSocket.OPEN;
  }

  async invokeRpc(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) throw new DisconnectedError();
      const id = this.id++;
      const prom = this.requests[id] = {
        resolve: (val?: any) => {
          delete this.requests[id];
          resolve(val);
        },
        reject: (err?: any) => {
          delete this.requests[id];
          reject(err);
        }
      };
      try {
        this._ws!.send(borc.encode({
          id,
          ...data
        }), err => {
          if (err) prom.reject(err);
        });
      } catch (err) {
        prom.reject(err);
      }
    });
  }

  protected abstract onPing(data: any): void;
  protected abstract onError(err: any): void;

  protected onOpen(): void {
    console.log(`[${this.opts.nodeUrl}] Peer has connected`);
  }

  protected onClose(code: number, msg: string): void {
    console.log(`[${this.opts.nodeUrl}] Peer has disconnected (${code}; ${msg ? msg : 'no reason provided'})`);
    this.ws = undefined;

    const requests = Object.values(this.requests);
    this.requests = {};
    for (const req of requests) {
      setImmediate(() => {
        req.reject(new DisconnectedError());
      });
    }
  }

  protected async onMessage(data: any): Promise<void> {
    try {
      if (typeof(data) === 'string') {
        this._ws!.close(WsCloseCode.UNSUPPORTED_DATA, 'text not supported');
      } else if (data instanceof ArrayBuffer) {
        const map = borc.decode(Buffer.from(data));

        // Check for an event
        if (map.event) {
          this.emit(`net_event_${map.event}`, map);
          return;
        }

        // Prepare RPC call data
        const id = map.id;
        if (typeof(id) !== 'number') {
          this._ws!.close(WsCloseCode.POLICY_VIOLATION, 'id must be a number');
          return;
        }

        // Check for an RPC invocation
        if (map.method) {
          try {
            const resp = await this.processMessage(map);
            await this.sendId(id, resp);
          } catch (e) {
            await this.sendId(id, {
              error: e instanceof ApiError ? e.code : ApiErrorCode.MISC,
              message: e.message
            });
          } finally {
            return;
          }
        }

        // Check for an RPC response
        if (map.error) this.requests[id].reject(map);
        else this.requests[id].resolve(map);
      }
    } catch (e) {
      console.log('Failed to process message from', this.opts.nodeUrl, e);
    }
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
        if (this.opts.pool.writable) {
          const data = await this.opts.pool.push(tx);
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
          block_height: this.opts.blockchain.head.height.toString(),
          network_fee: [
            this.opts.blockchain.networkFee[0].toString(),
            this.opts.blockchain.networkFee[1].toString()
          ]
        };
      }
      case 'get_block': {
        const height: number = map.height;
        check(typeof(height) === 'number', ApiErrorCode.INVALID_PARAMS, 'height must be a number');
        check(height >= 0, ApiErrorCode.INVALID_PARAMS, 'height must be >= 0');
        const block = await this.opts.blockchain.getBlock(height);
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
          const block = await this.opts.blockchain.getBlock(i);
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
        const fee = await this.opts.pool.getTotalFee(wif);
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
        const balance = await this.opts.pool.getBalance(PublicKey.fromWif(address));
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
            await this.sendEvent('block', {
              block: block.fullySerialize().toBuffer()
            });
          } catch (e) {
            if (e instanceof DisconnectedError) {
              this.opts.blockchain.removeListener('block', this.blockHandler!);
              this.blockHandler = undefined;
            } else {
              console.log(`[${this.opts.nodeUrl}] Failed to push block to client`);
            }
          }
        };
        setImmediate(() => {
          this.opts.blockchain.on('block', this.blockHandler!);
        });
        return {
          block: this.opts.blockchain.head.fullySerialize().toBuffer()
        };
      }
      default:
        throw new ApiError(ApiErrorCode.UNKNOWN_METHOD, 'unknown method');
    }
  }

  private sendEvent(event: string, data: any): Promise<void> {
    const buf = borc.encode({
      event,
      ...data
    });
    return this.send(buf);
  }

  private sendId(id: number, data: any): Promise<void> {
    const buf = borc.encode({
      id,
      ...data
    });
    return this.send(buf);
  }

  private async send(data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.isOpen) return reject(new DisconnectedError());
      this.ws!.send(data, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export interface PromiseLike {
  resolve: (value?: any) => void;
  reject: (err?: any) => void;
}
