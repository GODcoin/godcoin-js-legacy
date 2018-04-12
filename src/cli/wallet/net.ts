import * as WebSocket from 'ws';
import * as cbor from 'cbor';

export class WalletNet {

  private requests: {[key: number]: PromiseLike} = {};
  private ws!: WebSocket;
  private id = 0;

  constructor(readonly nodeUrl) {
  }

  send(data: any): Promise<any> {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const prom = this.requests[id] = {
        resolve: (val?: any) => {
          delete this.requests[id];
          resolve(val);
        },
        reject: (err?: any) => {
          delete this.requests[id];
          reject(err);
        }
      };
      try {
        this.ws.send(cbor.encode({
          id,
          ...data
        }), err => {
          if (err) prom.reject(err);
        });
      } catch (err) {
        prom.reject(err);
      }
    });
  }

  async open() {
    return new Promise<void>((resolve, reject) => {
      let completed = false;
      this.ws = new WebSocket(this.nodeUrl);

      this.ws.on('open', () => {
        completed = true;
        resolve();
      });

      this.ws.on('close', () => {
        // TODO
      });

      this.ws.on('error', err => {
        if (completed) return console.log('Unknown WS error', err);
        completed = true;
        reject(err);
      });

      this.ws.on('ping', () => {
        this.ws.pong();
      });

      this.ws.on('message', data => {
        try {
          const map = cbor.decode(data as Buffer);
          const id = map.id;
          if (id === null || id === undefined) throw new Error('missing id');
          this.requests[id].resolve(map);
        } catch (e) {
          console.log('Failed to process message from server', e);
        }
      });
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

interface PromiseLike {
  resolve: (value: any) => void;
  reject: (err?: any) => void;
}
