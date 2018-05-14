import {
  DisconnectedError,
  BlockRange,
  ClientPeer,
  ClientNet
} from '../client_peer';
import { SignedBlock } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { EventEmitter } from 'events';

export class ClientPeerPool extends EventEmitter {

  private clients: ClientPeer[] = [];
  private index = 0;

  private connectedCount = 0;

  get count() { return this.clients.length; }

  async addNode(nodeUrl: string) {
    const peer = new ClientPeer(new ClientNet(nodeUrl));
    this.clients.push(peer);
  }

  async start() {
    this.index = 0;
    for (const client of this.clients) {
      client.net.on('open', () => {
        console.log(`[${client.net.nodeUrl}] Successfully connected to peer`);
        if (this.connectedCount++ === 0) this.emit('open');
      });

      client.net.on('close', () => {
        console.log(`[${client.net.nodeUrl}] Disconnected from peer`);
        if (--this.connectedCount === 0) this.emit('close');
      });

      await client.start();
    }
  }

  async stop() {
    this.index = 0;
    for (const client of this.clients) await client.stop();
  }

  async subscribeBlock(cb: (block: SignedBlock) => void) {
    let lastHeight: Long|undefined;
    const handler = (data: any) => {
      const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(data.block));
      if (block.height.gt(lastHeight!)) {
        lastHeight = block.height;
        cb(block);
      }
    };
    for (const client of this.clients) {
      client.net.on('open', async () => {
        try {
          await client.subscribeBlock();
        } catch (e) {
          console.log(`[${client.net.nodeUrl}] Failed to subscribe to incoming blocks`, e);
        }
      });

      client.net.on('net_event_block', handler);
      try {
        const b = await client.subscribeBlock();
        if (!lastHeight) {
          lastHeight = b.height;
          cb(b);
        }
      } catch (e) {
        console.log(`[${client.net.nodeUrl}] Failed to subscribe to incoming blocks`, e);
      }
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

export class EndOfClients extends Error {
  constructor() {
    super('end of clients');
  }
}
