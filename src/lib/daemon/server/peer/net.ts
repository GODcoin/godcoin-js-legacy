import { ApiErrorCode, WsCloseCode, ApiError } from './api_error';
import { EventEmitter } from 'events';
import * as WebSocket from 'uws';
import * as cbor from 'cbor';

export type MessageCallback = (map: any) => Promise<any>;

export class PeerNet {

  private readonly ws: WebSocket;
  readonly ip: string;

  private pingTimer?: NodeJS.Timer;
  private lastPing = Date.now();

  constructor(ws: WebSocket, ip: string) {
    this.ws = ws;
    this.ip = ip;
  }

  init(cb: MessageCallback): void {
    this.ws.on('close', () => {
      console.log(`[${this.ip}] Peer has disconnected`);
      this.ws.removeAllListeners();
    });

    this.ws.on('message', async data => {
      try {
        if (typeof(data) === 'string') {
          this.close(WsCloseCode.UNSUPPORTED_DATA, 'text not supported');
        } else if (data instanceof ArrayBuffer) {
          data = Buffer.from(data);
          const map = cbor.decode(data);
          const id = map.id;
          if (typeof(id) !== 'number') {
            this.close(WsCloseCode.POLICY_VIOLATION, 'id must be a number');
            return;
          }
          try {
            const resp = await cb(map);
            await this.send(cbor.encode({
              id,
              ...resp
            }));
          } catch (e) {
            await this.send(cbor.encode({
              id,
              error: e instanceof ApiError ? e.code : ApiErrorCode.MISC,
              message: e.message
            }));
          }
        }
      } catch (e) {
        console.log(`[${this.ip}] Failed to process message`, e);
      }
    });
  }

  send(data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws.send(data, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  close(code: WsCloseCode = 1000, reason?: string): void {
    this.ws.close(code, reason);
  }
}
