import { Blockchain } from '../../blockchain';
import { Minter } from '../../producer';
import { Peer, PeerNet } from './peer';
import * as WebSocket from 'uws';
import * as http from 'http';
import * as Koa from 'koa';

export interface ServerOptions {
  blockchain: Blockchain;
  minter?: Minter;
  bindAddress: string;
  port: number;
}

export class Server {

  private readonly blockchain: Blockchain;
  private readonly minter?: Minter;
  private readonly bindAddr: string;
  private readonly port: number;

  private readonly app = new Koa();
  private ws = new WebSocket.Server({
    noServer: true
  });
  private server?: http.Server;

  constructor(opts: ServerOptions) {
    this.blockchain = opts.blockchain;
    this.minter = opts.minter;
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
        if (process.env.GODCOIN_TRUST_PROXY === 'true') {
          const tmp = req.headers['x-forwarded-for'];
          if (typeof(tmp) === 'string') ip = tmp.split(',')[0];
          else if (tmp) ip = tmp[0].split(',')[0];
        }
        console.log(`[${ip}] Peer has connected`);
        const peerNet = new PeerNet(ws, ip);
        const peer = new Peer({
          blockchain: this.blockchain,
          minter: this.minter,
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
