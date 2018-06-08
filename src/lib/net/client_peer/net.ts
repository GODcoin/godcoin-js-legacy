import { Net, NetOpts, PromiseLike } from '../net';
import { Lock } from '../../lock';
import * as WebSocket from 'uws';
import * as assert from 'assert';

export class ClientNet extends Net {

  private readonly openLock = new Lock();
  private openPromise?: PromiseLike;
  private openTimer?: NodeJS.Timer;
  private running = false;

  private pingTimer?: NodeJS.Timer;
  private lastPing = 0;

  constructor(opts: NetOpts) {
    super(opts);
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

  private async open(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      if (!this.running) return;

      await this.openLock.lock();
      if (this.ws && (this.ws.readyState === WebSocket.OPEN
                      || this.ws.readyState === WebSocket.CONNECTING)) {
        this.openLock.unlock();
        return resolve();
      }

      this.ws = new WebSocket(this.opts.nodeUrl);
      this.openPromise = { resolve, reject };
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
          console.log(`[${this.opts.nodeUrl}] Failed to connect to peer`, e);
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
      if (now - this.lastPing > 4000 && this.isOpen) {
        this.ws!.close();
      }
    }, 4000);
  }

  protected onOpen() {
    if (this.openPromise) {
      this.openLock.unlock();
      this.lastPing = Date.now();
      this.openPromise.resolve();
      this.openPromise = undefined;
    }
    super.onOpen();
  }

  protected onClose(code: number, msg: string) {
    setImmediate(() => {
      if (this.running) this.startOpenTimer();
    });
    super.onClose(code, msg);
  }

  protected onPing() {
    this.lastPing = Date.now();
  }

  protected onError(err: any) {
    if (!this.openPromise) return console.log('Unknown WS error', err);
    this.openLock.unlock();
    this.openPromise.reject(err);
    this.openPromise = undefined;
  }
}
