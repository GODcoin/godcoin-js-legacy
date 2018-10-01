import * as assert from 'assert';
import { RpcMsgType } from 'godcoin-neon';
import * as net from 'net';
import { Lock } from '../../lock';
import { PromiseLike } from '../../node-util';
import { Net } from '../net';

enum ConnectState {
  OPEN,
  CLOSED,
  CONNECTING
}

export class ClientNet extends Net {

  private connectState = ConnectState.CLOSED;
  private readonly openLock = new Lock();
  private openTimer?: NodeJS.Timer;
  private handshakePromise?: PromiseLike;
  private running = false;

  constructor(nodeUrl: string) {
    super(nodeUrl);
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

    if (this.handshakePromise) {
      this.handshakePromise.reject(new Error('shutting down'));
      this.handshakePromise = undefined;
    }
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = undefined;
    }

    await this.openLock.lock();
    if (this.socket) this.socket.end();
    this.openLock.unlock();
  }

  protected isServerSide() {
    return false;
  }

  protected async onOpen() {
    try {
      await new Promise(async (_resolve, _reject) => {
        const resolve = () => {
          this.handshakePromise = undefined;
          clearTimeout(timer);
          _resolve();
        };
        const reject = (err: Error) => {
          this.handshakePromise = undefined;
          clearTimeout(timer);
          _reject(err);
        };
        this.handshakePromise = { resolve, reject };

        const handler = data => {
          // Handshake completed
          if (data.id === 0) {
            clearTimeout(timer);
            resolve();
          }
        };
        this.once('message', handler);

        const timer = setTimeout(() => {
          this.removeListener('message', handler);
          reject(new Error('handshake timeout'));
        }, 3000);

        try {
          // Send the handshake request
          await this.send({
            id: 0,
            msg_type: RpcMsgType.HANDSHAKE,
            req: {
              peer_type: this.peerType
            }
          });
        } catch (e) {
          this.removeListener('message', handler);
          reject(e);
        }
      });
    } catch (e) {
      if (this.socket) this.socket.end();
      console.log(`${this.formatLogPrefix()} Open handler failed\n`, e);
      this.openLock.unlock();
      return;
    }
    this.openLock.unlock();
    super.onOpen();
  }

  protected onClose() {
    setImmediate(() => {
      if (this.running) this.startOpenTimer();
    });
    this.connectState = ConnectState.CLOSED;
    super.onClose();
  }

  protected onError(err: any) {
    console.log('Unknown socket error', err);
  }

  private async open(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      if (!this.running) return;

      await this.openLock.lock();
      if (this.connectState === ConnectState.OPEN
          || this.connectState === ConnectState.CONNECTING) {
        this.openLock.unlock();
        return resolve();
      }

      this.connectState = ConnectState.CONNECTING;
      const split = this.nodeUrl.split(':');
      const port = Number.parseInt(split[1]);
      assert(!isNaN(port), 'port must not be NaN');

      const socket = net.connect(port, split[0]);

      const connectHandler = () => {
        socket.removeListener('error', errHandler);
        this.connectState = ConnectState.OPEN;

        this.socket = socket;
        this.socket.emit('open');
        resolve();
      };

      const errHandler = e => {
        socket.removeListener('connect', connectHandler);
        this.connectState = ConnectState.CLOSED;
        this.socket = undefined;
        this.openLock.unlock();
        reject(e);
      };

      socket.once('connect', connectHandler);
      socket.once('error', errHandler);
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
          console.log(`${this.formatLogPrefix()} Failed to connect to peer`, e);
          resolve(false);
          if (this.running) this.startOpenTimer(++tries);
        }
      }, tries === 0 ? 0 : Math.min(10000, Math.floor(Math.pow(2, tries) * 700 * Math.random())));
    });
  }
}
