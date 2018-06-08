import {
  DisconnectedError,
  ApiErrorCode,
  WsCloseCode,
  ApiError,
  check
} from './errors';
import { SignedBlock, Blockchain } from '../blockchain';
import { LocalMinter, TxPool } from '../producer';
import { PromiseLike } from '../node-util';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { EventEmitter } from 'events';
import { Tx } from '../transactions';
import * as rpc from './rpc_model';
import * as borc from 'borc';
import { Net } from './net';

export interface PeerOpts {
  blockchain: Blockchain;
  minter?: LocalMinter;
  pool: TxPool;
}

export class Peer extends EventEmitter {

  private requests: {[key: number]: PromiseLike} = {};
  private id = 0;

  private blockHandler?: (block: SignedBlock) => void;
  private txHandler?: (block: Tx, nodeOrigin: string) => void;

  constructor(readonly opts: PeerOpts, readonly net: Net) {
    super();
    this.net.on('message', this.onMessage.bind(this));
    this.net.on('close', this.onClose.bind(this));
  }

  async broadcast(tx: Buffer): Promise<rpc.BroadcastResult> {
    return await this.invokeRpc({
      method: 'broadcast',
      tx
    });
  }

  async subscribeTx(): Promise<void> {
    await this.invokeRpc({
      method: 'subscribe_tx'
    });
  }

  async subscribeBlock(): Promise<SignedBlock> {
    const data = (await this.invokeRpc({
      method: 'subscribe_block'
    })).block;
    return SignedBlock.fullyDeserialize(ByteBuffer.wrap(data));
  }

  async getProperties(): Promise<rpc.NetworkProperties> {
    return await this.invokeRpc({
      method: 'get_properties'
    });
  }

  async getBlock(height: number): Promise<SignedBlock|undefined> {
    const data = await this.invokeRpc({
      method: 'get_block',
      height
    });
    if (!data.block) return;
    const buf = ByteBuffer.wrap(data.block);
    return SignedBlock.fullyDeserialize(buf);
  }

  async getBlockRange(minHeight: number, maxHeight: number): Promise<rpc.BlockRange> {
    const data = await this.invokeRpc({
      method: 'get_block_range',
      min_height: minHeight,
      max_height: maxHeight
    });

    const blocks: SignedBlock[] = [];
    for (const block of data.blocks) {
      const buf = ByteBuffer.wrap(block);
      blocks.push(SignedBlock.fullyDeserialize(buf));
    }
    return {
      range_outside_height: data.range_outside_height,
      blocks
    };
  }

  async getBalance(address: string): Promise<[string,string]> {
    return (await this.invokeRpc({
      method: 'get_balance',
      address
    })).balance;
  }

  async getTotalFee(address: string): Promise<[string,string]> {
    return (await this.invokeRpc({
      method: 'get_total_fee',
      address
    })).fee;
  }

  async invokeRpc(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.net.isOpen) throw new DisconnectedError();
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
        this.net.ws!.send(borc.encode({
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

  private async onMessage(map: any): Promise<void> {
    try {
      // Check for an event
      if (map.event) {
        this.emit(`net_event_${map.event}`, map);
        return;
      }

      // Prepare RPC call data
      const id = map.id;
      if (typeof(id) !== 'number') {
        this.net.ws!.close(WsCloseCode.POLICY_VIOLATION, 'id must be a number');
        return;
      }

      // Check for an RPC invocation
      if (map.method) {
        try {
          const resp = await this.processMessage(map);
          await this.net.sendId(id, resp);
        } catch (e) {
          await this.net.sendId(id, {
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
    } catch (e) {
      console.log(`[${this.net.nodeUrl}] Failed to process message`, e);
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
          const data = await this.opts.pool.push(tx, this.net.nodeUrl);
          refBlock = data[0];
          refTxPos = data[1];
          return {
            ref_block: refBlock.toString(),
            ref_tx_pos: refTxPos
          };
        }
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
      case 'subscribe_tx': {
        // Subscribes to newly broadcasted tx's to be included in a block
        check(!this.txHandler, ApiErrorCode.MISC, 'already subscribed');
        this.txHandler = async (tx, nodeOrigin) => {
          if (this.net.nodeUrl === nodeOrigin) return;
          try {
            await this.net.sendEvent('tx', {
              tx: tx.serialize(true).toBuffer()
            });
          } catch (e) {
            if (e instanceof DisconnectedError) {
              this.opts.pool.removeListener('tx', this.txHandler!);
              this.txHandler = undefined;
            } else {
              console.log(`[${this.net.nodeUrl}] Failed to push tx to client`, e);
            }
          }
        };
        setImmediate(() => {
          this.opts.pool.on('tx', this.txHandler!);
        });
        return {};
      }
      case 'subscribe_block': {
        // Subscribes to live generated blocks
        check(!this.blockHandler, ApiErrorCode.MISC, 'already subscribed');
        this.blockHandler = async (block: SignedBlock) => {
          try {
            await this.net.sendEvent('block', {
              block: block.fullySerialize().toBuffer()
            });
          } catch (e) {
            if (e instanceof DisconnectedError) {
              this.opts.blockchain.removeListener('block', this.blockHandler!);
              this.blockHandler = undefined;
            } else {
              console.log(`[${this.net.nodeUrl}] Failed to push block to client`, e);
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

  private onClose(): void {
    const requests = Object.values(this.requests);
    this.requests = {};
    for (const req of requests) {
      setImmediate(() => {
        req.reject(new DisconnectedError());
      });
    }

    if (this.blockHandler) {
      this.opts.blockchain.removeListener('block', this.blockHandler);
      this.blockHandler = undefined;
    }

    if (this.txHandler) {
      this.opts.pool.removeListener('tx', this.txHandler);
      this.txHandler = undefined;
    }
  }
}
