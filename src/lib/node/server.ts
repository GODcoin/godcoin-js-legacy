import { SignedBlock, Tx } from 'godcoin-neon';
import * as net from 'net';
import { Blockchain } from '../blockchain';
import { ServerNet, ServerPeer } from '../net';
import { TxPool } from '../producer';
import { Synchronizer } from './synchronizer';

export interface ServerOptions {
  blockchain: Blockchain;
  pool: TxPool;
  bindAddress: string;
  port: number;
}

export class Server {

  private readonly blockchain: Blockchain;
  private readonly pool: TxPool;
  private readonly bindAddr: string;
  private readonly port: number;

  private _clientCount = 0;
  private server?: net.Server;

  get clientCount(): number {
    return this._clientCount;
  }

  constructor(opts: ServerOptions) {
    this.blockchain = opts.blockchain;
    this.pool = opts.pool;
    this.bindAddr = opts.bindAddress;
    this.port = opts.port;
  }

  start(sync: Synchronizer): void {
    if (this.server) return;

    this.server = new net.Server(async socket => {
      socket.unref();
      const ip = socket.remoteAddress!;
      const port = socket.remotePort!;
      const serverNet = new ServerNet(ip + ':' + port, socket);
      const peer = new ServerPeer({
        blockchain: this.blockchain,
        pool: this.pool
      }, serverNet);
      try {
        await peer.init();
        peer.on('net_event_block', async (block: SignedBlock) => {
          try {
            await sync.handleBlock(block);
          } catch (e) {
            console.log(`${serverNet.formatLogPrefix()} Failed to deserialize block`, e);
          }
        });
        peer.on('net_event_tx', async (tx: Tx) => {
          try {
            await sync.handleTx(tx);
          } catch (e) {
            console.log(`${serverNet.formatLogPrefix()} Failed to handle transaction`, e);
          }
        });
      } catch (e) {
        console.log(`${serverNet.formatLogPrefix()} Failed to initialize peer`, e);
        if (serverNet.socket && serverNet.isOpen) {
          serverNet.socket.end();
        }
      }
    }).listen(this.port, this.bindAddr, () => {
      console.log(`Server bound to ${this.bindAddr}:${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }
}
