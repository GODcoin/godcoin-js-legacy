import { EventEmitter } from 'events';
import {
  Asset,
  PeerType,
  PublicKey,
  RpcEventType,
  RpcMsgEvent,
  RpcMsgResProperties,
  RpcMsgType,
  RpcPayload,
  SignedBlock,
  Tx
} from 'godcoin-neon';
import { Blockchain } from '../blockchain';
import { PromiseLike } from '../node-util';
import { LocalMinter, TxPool } from '../producer';
import {
  ApiError,
  DisconnectedError
} from './errors';
import { Net } from './net';
import * as rpcModel from './rpc_model';

export interface PeerOpts {
  blockchain: Blockchain;
  minter?: LocalMinter;
  pool: TxPool;
}

export class Peer extends EventEmitter {

  private requests: {[key: number]: PromiseLike} = {};
  private id = 0;

  private blockHandler?: (block: SignedBlock) => void;
  private txHandler?: (block: Tx) => void;

  constructor(readonly opts: PeerOpts, readonly net: Net) {
    super();
    this.net.on('message', this.onMessage.bind(this));
    this.net.on('close', this.onClose.bind(this));
    this.net.on('open', this.onOpen.bind(this));
  }

  async broadcast(tx: Tx): Promise<void> {
    await this.invokeRpc({
      id: ++this.id,
      msg_type: RpcMsgType.BROADCAST,
      req: tx
    });
  }

  async getProperties(): Promise<RpcMsgResProperties> {
    return (await this.invokeRpc({
      id: ++this.id,
      msg_type: RpcMsgType.PROPERTIES
    })).res;
  }

  async getBlock(height: number): Promise<SignedBlock|undefined> {
    return (await this.invokeRpc({
      id: ++this.id,
      msg_type: RpcMsgType.BLOCK,
      req: {
        height
      }
    })).res;
  }

  async getBlockRange(minHeight: number, maxHeight: number): Promise<rpcModel.BlockRange> {
    let range_outside_height = false;
    const blocks: SignedBlock[] = [];
    for (let i = minHeight; i <= maxHeight; ++i) {
      const blk = await this.getBlock(i);
      if (!blk) {
        range_outside_height = true;
        break;
      }
      blocks.push(blk);
    }

    return {
      range_outside_height,
      blocks
    };
  }

  async getBalance(address: PublicKey): Promise<[Asset, Asset]> {
    return (await this.invokeRpc({
      id: ++this.id,
      msg_type: RpcMsgType.BALANCE,
      req: address
    })).res;
  }

  async getTotalFee(address: PublicKey): Promise<[Asset, Asset]> {
    return (await this.invokeRpc({
      id: ++this.id,
      msg_type: RpcMsgType.TOTAL_FEE,
      req: address
    })).res;
  }

  async invokeRpc(rpc: RpcPayload): Promise<RpcPayload> {
    return new Promise<RpcPayload>(async (resolve, reject) => {
      if (!this.net.isOpen) return reject(new DisconnectedError());
      const id = rpc.id;
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
        await this.net.send(rpc);
      } catch (err) {
        prom.reject(err);
      }
    });
  }

  protected removeSubscriptions() {
    if (this.blockHandler) {
      this.opts.blockchain.removeListener('block', this.blockHandler);
      this.blockHandler = undefined;
    }
    if (this.txHandler) {
      this.opts.pool.removeListener('tx', this.txHandler);
      this.txHandler = undefined;
    }
  }

  protected addSubscriptions() {
    if (this.txHandler || this.blockHandler) return;
    this.txHandler = async tx => {
      try {
        await this.net.send({
          id: ++this.id,
          msg_type: RpcMsgType.EVENT,
          res: {
            type: RpcEventType.TX,
            data: tx
          }
        });
      } catch (e) {
        if (!(e instanceof DisconnectedError)) {
          console.log(`[${this.net.nodeUrl}] Failed to push tx to client`, e);
        }
      }
    };

    this.blockHandler = async (block: SignedBlock) => {
      try {
        await this.net.send({
          id: ++this.id,
          msg_type: RpcMsgType.EVENT,
          res: {
            type: RpcEventType.BLOCK,
            data: block
          }
        });
      } catch (e) {
        if (!(e instanceof DisconnectedError)) {
          console.log(`[${this.net.nodeUrl}] Failed to push block to client`, e);
        }
      }
    };

    setImmediate(() => {
      this.opts.pool.on('tx', this.txHandler!);
      this.opts.blockchain.on('block', this.blockHandler!);
    });
  }

  private async onMessage(rpc: RpcPayload): Promise<void> {
    try {
      // Check for an event
      if (rpc.msg_type === RpcMsgType.EVENT) {
        const evt: RpcMsgEvent = rpc.req;
        if (evt.type === RpcEventType.BLOCK) {
          this.emit('net_event_block', evt.data);
        } else if (evt.type === RpcEventType.TX) {
          this.emit('net_event_tx', evt.data);
        }
        return;
      }

      // Check for an RPC invocation
      if (rpc.req) {
        try {
          const resp = await this.processMessage(rpc);
          await this.net.send(resp);
        } catch (e) {
          await this.net.send({
            id: rpc.id,
            msg_type: RpcMsgType.ERROR,
            res: {
              error: e.message
            }
          });
        }
        return;
      }

      // Resolve any pending RPC request
      const req = this.requests[rpc.id];
      if (req) {
        if (rpc.msg_type === RpcMsgType.ERROR) req.reject(rpc.res.error);
        else req.resolve(rpc);
      }
    } catch (e) {
      console.log(`[${this.net.nodeUrl}] Failed to process message`, e);
    }
  }

  private async processMessage(rpc: RpcPayload): Promise<RpcPayload> {
    const method = rpc.msg_type;
    switch (method) {
      case RpcMsgType.BROADCAST: {
        const tx: Tx = rpc.req;
        const buf = tx.encodeWithSigs();
        await this.opts.pool.push(buf, buf.toString('hex'));
        return {
          id: rpc.id,
          msg_type: RpcMsgType.NONE
        };
      }
      case RpcMsgType.PROPERTIES: {
        const props: RpcMsgResProperties = {
          height: this.opts.blockchain.head.height,
          token_supply: await this.opts.blockchain.indexer.getTokenSupply()
        };
        return {
          id: rpc.id,
          msg_type: RpcMsgType.PROPERTIES,
          res: props
        };
      }
      case RpcMsgType.BLOCK: {
        const height: number = rpc.req!.height;
        const block = await this.opts.blockchain.getBlock(height);
        const data: RpcPayload = {
          id: rpc.id,
          msg_type: RpcMsgType.BLOCK,
          res: block
        };
        return data;
      }
      case RpcMsgType.BALANCE: {
        const address: PublicKey = rpc.req!;
        const balance = await this.opts.pool.getBalance(address);
        return {
          id: rpc.id,
          msg_type: RpcMsgType.BALANCE,
          res: balance
        };
      }
      case RpcMsgType.TOTAL_FEE: {
        const address: PublicKey = rpc.req!;
        const fee = await this.opts.pool.getTotalFee(address);
        return {
          id: rpc.id,
          msg_type: RpcMsgType.TOTAL_FEE,
          res: fee
        };
      }
      default:
        throw new ApiError('unknown method');
    }
  }

  private onOpen(): void {
    if (this.net.peerType === PeerType.NODE) {
      this.addSubscriptions();
    }
  }

  private onClose(): void {
    this.removeSubscriptions();
    const requests = Object.values(this.requests);
    this.requests = {};
    for (const req of requests) {
      setImmediate(() => {
        req.reject(new DisconnectedError());
      });
    }
  }
}
