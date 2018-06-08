import {
  DisconnectedError,
  EndOfClients,
  BlockRange,
  ClientPeer,
  ClientNet,
  NetOpts
} from '../net';
import { SignedBlock } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { EventEmitter } from 'events';

export class ClientPeerPool extends EventEmitter {

  private clients: ClientPeer[] = [];
  private index = 0;

  private connectedCount = 0;

  get count() { return this.clients.length; }

  async addNode(opts: NetOpts) {
    const peer = new ClientPeer(new ClientNet(opts));
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
      cb(Buffer.from(data.tx));
    };

    for (const client of this.clients) {
      client.net.on('open', async () => {
        try {
          await client.subscribeTx();
        } catch (e) {
          console.log(`[${client.net.opts.nodeUrl}] Failed to subscribe to incoming transactions`, e);
        }
      });

      client.on('net_event_tx', handler);
      if (client.net.isOpen) {
        try {
          await client.subscribeTx();
        } catch (e) {
          console.log(`[${client.net.opts.nodeUrl}] Failed to subscribe to incoming transactions`, e);
        }
      }
    }
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
          console.log(`[${client.net.opts.nodeUrl}] Failed to subscribe to incoming blocks`, e);
        }
      });

      client.on('net_event_block', handler);
      if (client.net.isOpen) {
        try {
          const b = await client.subscribeBlock();
          if (!lastHeight) {
            lastHeight = b.height;
            cb(b);
          }
        } catch (e) {
          console.log(`[${client.net.opts.nodeUrl}] Failed to subscribe to incoming blocks`, e);
        }
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
