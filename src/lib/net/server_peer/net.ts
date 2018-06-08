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

  init(): void {
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
