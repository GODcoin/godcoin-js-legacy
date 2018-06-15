import {
  DisconnectedError,
  EndOfClients,
  BlockRange,
  ClientPeer,
  ClientType,
  ClientNet,
  PeerOpts
} from '../net';
import { SignedBlock } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { EventEmitter } from 'events';
import * as Long from 'long';

export class ClientPeerPool extends EventEmitter {

  private clients: ClientPeer[] = [];
  private index = 0;

  private connectedCount = 0;

  get count() { return this.clients.length; }

  async addNode(opts: PeerOpts, nodeUrl: string) {
    const net = new ClientNet(nodeUrl);
    net.clientType = ClientType.NODE;
    const peer = new ClientPeer(opts, net);
    this.clients.push(peer);
  }

  async start() {
    this.index = 0;
    for (const client of this.clients) {
      client.net.on('open', () => {
        if (this.connectedCount++ === 0) this.emit('open');
      });

      client.net.on('close', () => {
        if (--this.connectedCount === 0) this.emit('close');
      });

      await client.start();
    }
  }

  async stop() {
    this.index = 0;
    for (const client of this.clients) await client.stop();
  }

  async subscribeTx(cb: (tx: Buffer) => void) {
    const handler = (data: any) => {
      // TODO: server side clients need this handler
      cb(Buffer.from(data.tx));
    };

    for (const client of this.clients) {
      client.on('net_event_tx', handler);
    }
  }

  async subscribeBlock(cb: (block: SignedBlock) => void) {
    let lastHeight = Long.fromNumber(0, true);
    const handler = (data: any) => {
      // TODO: server side clients need this handler
      const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(data.block));
      if (block.height.gt(lastHeight)) {
        lastHeight = block.height;
        cb(block);
      }
    };
    for (const client of this.clients) {
      client.on('net_event_block', handler);
    }
  }

  async getBlockRange(min: number, max: number): Promise<BlockRange> {
    return this.invoke(ClientPeer.prototype.getBlockRange, min, max);
  }

  private async invoke(func: Function, ...args: any[]): Promise<any> {
    const clientLen = this.clients.length;
    const totalIndex = this.index + clientLen;
    for (let i = this.index; i < totalIndex; ++i) {
      this.index = (i + 1) % clientLen;
      try {
        const client = this.clients[this.index];
        return await func.call(client, ...args);
      } catch (e) {
        if (e instanceof DisconnectedError) continue;
        throw e;
      }
    }

    throw new EndOfClients();
  }

}
