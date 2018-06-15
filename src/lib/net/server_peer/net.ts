import * as ClientType from '../client_type';
import * as WebSocket from 'uws';
import { Net } from '../net';

export type MessageCallback = (map: any) => Promise<any>;

export class ServerNet extends Net {

  private pingTimer?: NodeJS.Timer;
  private lastPong = 0;

  constructor(nodeUrl: string, ws: WebSocket) {
    super(nodeUrl);
    this.ws = ws;
  }

  async init(): Promise<void> {
    // Send handshake
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('handshake timeout'));
      }, 3000);

      this.once('message', msg => {
        if (msg.id !== 0) {
          return reject(new Error('handshake id invalid'));
        }
        {
          const clientType = ClientType.toEnum(msg['client-type']);
          if (!clientType) {
            return reject(new Error('missing or invalid client-type'));
          }
          this.clientType = clientType;
        }
        try {
          this.sendId(0, {});
        } catch (e) {
          return reject(new Error('failed to send server handshake'));
        }
        clearTimeout(timer);
        resolve();
      });
    });

    this.onOpen();
    this.startPingTimer();

    this.ws!.on('pong', () => {
      this.lastPong = Date.now();
    });
  }

  private startPingTimer() {
    if (this.pingTimer) return;
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (!this.isOpen) return;
      const now = Date.now();
      if (now - this.lastPong > 4000) {
        this.ws!.close();
        return;
      }
      this.ws!.ping();
    }, 3000);
  }

  protected onClose(code: number, msg: string) {
    super.onClose(code, msg);
    this.removeAllListeners();
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  protected onError(err: any): void {
    console.log(`[${this.nodeUrl}] Unexpected error`, err);
  }

  protected onPing(): void {}
}
