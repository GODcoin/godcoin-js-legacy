import { ServerNet, ServerPeer, WsCloseCode } from '../net';
import { Blockchain, SignedBlock } from '../blockchain';
import { Synchronizer } from './synchronizer';
import * as ByteBuffer from 'bytebuffer';
import { TxPool } from '../producer';
import { GODcoinEnv } from '../env';
import * as WebSocket from 'uws';
import * as http from 'http';

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

  start(sync: Synchronizer): void {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end();
    }).listen(this.port, this.bindAddr, () => {
      console.log(`Server bound to ${this.bindAddr}:${this.port}`);
    });
    this.server.on('upgrade', (req: http.IncomingMessage, socket, head) => {
      let ip = req.connection.remoteAddress!;
      let port = req.connection.remotePort!;
      this.ws.handleUpgrade(req, socket, head, async ws => {
        if (GODcoinEnv.GODCOIN_TRUST_PROXY) {
          const tmp = req.headers['x-forwarded-for'];
          if (typeof(tmp) === 'string') ip = tmp.split(',')[0];
          else if (tmp) ip = tmp[0].split(',')[0];
        }
        const net = new ServerNet(ip + ':' + port, ws);
        const peer = new ServerPeer({
          blockchain: this.blockchain,
          pool: this.pool
        }, net);
        try {
          await peer.init();
          peer.on('net_event_block', (data: any) => {
            try {
              const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(data.block));
              sync.handleBlock(block);
            } catch (e) {
              console.log(`[${net.nodeUrl}] Failed to deserialize block`, e);
            }
          });
          peer.on('net_event_tx', (data: any) => {
            if (data.tx) sync.handleTx(Buffer.from(data.tx));
          });
        } catch (e) {
          console.log(`[${net.nodeUrl}] Failed to initialize peer`, e);
          if (net.ws && net.isOpen) {
            net.ws.close(WsCloseCode.POLICY_VIOLATION, e.message);
          }
        }
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
