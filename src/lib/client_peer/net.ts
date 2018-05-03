import * as WebSocket from 'uws';
import { Lock } from '../lock';
import * as borc from 'borc';

export class ClientNet {

  private readonly openLock = new Lock();

  private requests: {[key: number]: PromiseLike} = {};
  private ws!: WebSocket;
  private id = 0;

  get isOpen(): boolean {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  constructor(readonly nodeUrl) {
  }

  async send(data: any): Promise<any> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await this.open();
    }
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
        this.ws.send(borc.encode({
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

  async open(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      await this.openLock.lock();
      if (this.ws && (this.ws.readyState === WebSocket.OPEN
                      || this.ws.readyState === WebSocket.CONNECTING)) {
        this.openLock.unlock();
        return resolve();
      }

      let completed = false;
      this.ws = new WebSocket(this.nodeUrl);

      this.ws.on('open', () => {
        completed = true;
        this.openLock.unlock();
        resolve();
      });

      this.ws.on('close', () => {
        this.ws.removeAllListeners();

        const requests = Object.values(this.requests);
        this.requests = {};
        for (const req of requests) {
          setImmediate(() => {
            req.reject(new Error('disconnected'));
          });
        }
      });

      this.ws.on('error', err => {
        if (completed) return console.log('Unknown WS error', err);
        completed = true;
        this.openLock.unlock();
        reject(err);
      });

      this.ws.on('ping', () => {
        this.ws.pong();
      });

      this.ws.on('message', data => {
        try {
          const map = borc.decode(Buffer.from(data));
          const id = map.id;
          if (id === null || id === undefined) throw new Error('missing id');
          if (map.error) this.requests[id].reject(map);
          else this.requests[id].resolve(map);
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
