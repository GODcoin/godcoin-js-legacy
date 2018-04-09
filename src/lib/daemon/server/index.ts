import * as WebSocket from 'ws';
import * as http from 'http';
import * as Koa from 'koa';

export class Server {

  private readonly bindAddr: string;
  private readonly port: number;

  private readonly app = new Koa();
  private ws = new WebSocket.Server({
    noServer: true
  });
  private server?: http.Server;

  constructor(bindAddr: string, port: number) {
    this.bindAddr = bindAddr;
    this.port = port;
  }

  start(): void {
    if (this.server) return;

    const cb = this.app.callback();
    this.server = http.createServer(cb).listen(this.port, this.bindAddr, () => {
      console.log(`Server bound to ${this.bindAddr}:${this.port}`);
    });
    this.server.on('upgrade', (req, socket, head) => {
      this.ws.handleUpgrade(req, socket, head, ws => {
        ws.on('message', data => {
          // TODO: handle blockchain synchronization
          ws.send(data);
        });
        // TODO log incoming IP
        console.log('WS client connected');
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

}
