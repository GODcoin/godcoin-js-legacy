import { DisconnectedError } from '../errors';
import { EventEmitter } from 'events';
import { Lock } from '../../lock';
import * as WebSocket from 'uws';
import * as assert from 'assert';
import * as borc from 'borc';

export class ClientNet extends EventEmitter {

  private readonly openLock = new Lock();
  private openTimer?: NodeJS.Timer;
  private running = false;

  private pingTimer?: NodeJS.Timer;
  private lastPing = 0;
  private ws!: WebSocket;

  private requests: {[key: number]: PromiseLike} = {};
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
    this.startPingTimer();
    return await this.startOpenTimer(0);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.removeAllListeners();

    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = undefined;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
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
        this.lastPing = Date.now();
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

      this.ws.on('ping', (data) => {
        this.lastPing = Date.now();
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
      if (this.openTimer) clearTimeout(this.openTimer);
      this.openTimer = setTimeout(async () => {
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

  private startPingTimer() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastPing > 4000 && this.isOpen) this.ws.close();
    }, 4000);
  }
}

interface PromiseLike {
  resolve: (value: any) => void;
  reject: (err?: any) => void;
}
