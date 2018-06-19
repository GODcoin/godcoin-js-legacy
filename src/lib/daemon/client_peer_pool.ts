import {
  DisconnectedError,
  EndOfClients,
  BlockRange,
  ClientPeer,
  ClientType,
  ClientNet,
  PeerOpts
} from '../net';
import { Synchronizer } from './synchronizer';
import { SignedBlock } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { EventEmitter } from 'events';

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

  subscribeTx(sync: Synchronizer) {
    for (const client of this.clients) {
      client.on('net_event_tx', (data: any) => {
        try {
          if (data.tx) sync.handleTx(Buffer.from(data.tx));
        } catch (e) {
          console.log(`[${client.net.nodeUrl}] Failed to handle transaction`, e);
        }
      });
    }
  }

  subscribeBlock(sync: Synchronizer) {
    for (const client of this.clients) {
      client.on('net_event_block', (data: any) => {
        try {
          const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(data.block));
          sync.handleBlock(block);
        } catch (e) {
          console.log(`[${client.net.nodeUrl}] Failed to deserialize block`, e);
        }
      });
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
