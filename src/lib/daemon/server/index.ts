import { Minter, TxPool } from '../../producer';
import { Blockchain } from '../../blockchain';
import { Peer, PeerNet } from './peer';
import { GODcoinEnv } from '../../env';
import * as WebSocket from 'uws';
import * as http from 'http';
import * as Koa from 'koa';

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

  private readonly app = new Koa();
  private ws = new WebSocket.Server({
    noServer: true
  });
  private server?: http.Server;

  constructor(opts: ServerOptions) {
    this.blockchain = opts.blockchain;
    this.pool = opts.pool;
    this.bindAddr = opts.bindAddress;
    this.port = opts.port;
  }

  start(): void {
    if (this.server) return;

    const cb = this.app.callback();
    this.server = http.createServer(cb).listen(this.port, this.bindAddr, () => {
      console.log(`Server bound to ${this.bindAddr}:${this.port}`);
    });
    this.server.on('upgrade', (req: http.IncomingMessage, socket, head) => {
      let ip = req.connection.remoteAddress!;
      this.ws.handleUpgrade(req, socket, head, ws => {
        if (GODcoinEnv.GODCOIN_TRUST_PROXY) {
          const tmp = req.headers['x-forwarded-for'];
          if (typeof(tmp) === 'string') ip = tmp.split(',')[0];
          else if (tmp) ip = tmp[0].split(',')[0];
        }
        console.log(`[${ip}] Peer has connected`);
        const peerNet = new PeerNet(ws, ip);
        const peer = new Peer({
          blockchain: this.blockchain,
          pool: this.pool,
          net: peerNet
        });
        peer.init();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.server = undefined;
    }
  }

}
