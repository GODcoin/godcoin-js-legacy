import {
  DisconnectedError,
  BlockRange,
  ClientPeer,
  ClientNet
} from '../client_peer';

export class ClientPeerPool {

  private clients: ClientPeer[] = [];
  private index = 0;

  async addNode(nodeUrl: string) {
    const peer = new ClientPeer(new ClientNet(nodeUrl));
    this.clients.push(peer);
  }

  async start() {
    this.index = 0;
    for (const client of this.clients) {
      const connected = await client.start();
      if (connected) {
        console.log(`[${client.net.nodeUrl}] Successfully connected to peer`);
      }
    }
  }

  async stop() {
    this.index = 0;
    for (const client of this.clients) await client.stop();
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
        return await func.call(this.clients[this.index], args);
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
