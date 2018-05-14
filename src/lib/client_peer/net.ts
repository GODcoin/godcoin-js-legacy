import { EventEmitter } from 'events';
import * as WebSocket from 'uws';
import * as assert from 'assert';
import { Lock } from '../lock';
import * as borc from 'borc';

export class ClientNet extends EventEmitter {

  private readonly openLock = new Lock();
  private timer?: NodeJS.Timer;
  private running = false;

  private requests: {[key: number]: PromiseLike} = {};
  private ws!: WebSocket;
  private id = 0;

  get isOpen(): boolean {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  constructor(readonly nodeUrl) {
    super();
  }

  /**
   * @returns Whether the first connection was successful
   */
  async start(): Promise<boolean> {
    assert(!this.running, 'client network already started');
    this.running = true;
    return await this.startOpenTimer(0);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.removeAllListeners();

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.openLock.lock();
    if (this.ws) this.ws.close();
    this.openLock.unlock();
  }

  async send(data: any): Promise<any> {
    if (this.ws.readyState !== WebSocket.OPEN) throw new DisconnectedError();
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

  private async open(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      if (!this.running) return;

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
        this.emit('open');
      });

      this.ws.on('close', () => {
        this.emit('close');
        this.ws.removeAllListeners();

        const requests = Object.values(this.requests);
        this.requests = {};
        for (const req of requests) {
          setImmediate(() => {
            req.reject(new DisconnectedError());
          });
        }

        setImmediate(() => {
          if (this.running) this.startOpenTimer();
        });
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
          if (map.event) return this.emit(`net_event_${map.event}`, map);
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

  private async startOpenTimer(tries = 1): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        try {
          await this.open();
          resolve(true);
        } catch (e) {
          console.log(`[${this.nodeUrl}] Failed to connect to peer`, e);
          resolve(false);
          if (this.running) this.startOpenTimer(++tries);
        }
      }, tries === 0 ? 0 : Math.min(10000, Math.floor(Math.pow(2, tries) * 700 * Math.random())));
    });
  }
}

export class DisconnectedError extends Error {
  constructor() {
    super('disconnected');
  }
}

interface PromiseLike {
  resolve: (value: any) => void;
  reject: (err?: any) => void;
}
