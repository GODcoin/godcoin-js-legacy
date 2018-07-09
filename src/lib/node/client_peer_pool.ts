import * as ByteBuffer from 'bytebuffer';
import { EventEmitter } from 'events';
import { SignedBlock } from '../blockchain';
import {
  BlockRange,
  ClientNet,
  ClientPeer,
  ClientType,
  DisconnectedError,
  EndOfClients,
  PeerOpts
} from '../net';

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
    this.removeAllListeners();
    for (const client of this.clients) await client.stop();
  }

  subscribeTx(cb: (tx: Buffer) => Promise<void>) {
    for (const client of this.clients) {
      client.on('net_event_tx', async (data: any) => {
        try {
          if (data.tx) cb(Buffer.from(data.tx));
        } catch (e) {
          console.log(`[${client.net.nodeUrl}] Failed to handle transaction`, e);
        }
      });
    }
  }

  subscribeBlock(cb: (b: SignedBlock) => Promise<void>) {
    for (const client of this.clients) {
      client.on('net_event_block', async (data: any) => {
        try {
          if (data.block) {
            const byteBuf = ByteBuffer.wrap(data.block);
            const block = SignedBlock.fullyDeserialize(byteBuf);
            await cb(block);
          }
        } catch (e) {
          console.log(`[${client.net.nodeUrl}] Failed to deserialize block`, e);
        }
      });
    }
  }

  async getBlockRange(min: number, max: number): Promise<BlockRange> {
    return this.invoke(ClientPeer.prototype.getBlockRange, min, max);
  }

  // tslint:disable-next-line:ban-types
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
