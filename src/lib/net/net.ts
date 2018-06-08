import { DisconnectedError, WsCloseCode } from './errors';
import { EventEmitter } from 'events';
import * as WebSocket from 'uws';
import * as borc from 'borc';

export abstract class Net extends EventEmitter {

  private _ws?: WebSocket;

  get ws(): WebSocket|undefined {
    return this._ws;
  }

  set ws(socket: WebSocket|undefined) {
    if (socket) {
      // Server side socket is already open
      if (socket.readyState !== WebSocket.OPEN) socket.on('open', this.onOpen.bind(this));
      socket.on('close', this.onClose.bind(this));
      socket.on('message', this.onMessage.bind(this));
      socket.on('ping', this.onPing.bind(this));
      socket.on('error', this.onError.bind(this));
    } else if (this._ws) {
      this._ws.close();
      this._ws.removeAllListeners();
    }
    this._ws = socket;
  }

  get isOpen(): boolean {
    return this._ws !== undefined && this._ws.readyState === WebSocket.OPEN;
  }

  constructor(readonly nodeUrl: string) {
    super();
  }

  protected abstract onPing(data: any): void;
  protected abstract onError(err: any): void;

  protected onOpen(): void {
    console.log(`[${this.nodeUrl}] Peer has connected`);
    this.emit('open');
  }

  protected onClose(code: number, msg: string): void {
    console.log(`[${this.nodeUrl}] Peer has disconnected (${code}; ${msg ? msg : 'no reason provided'})`);
    this.ws = undefined;
    this.emit('close');
  }

  protected async onMessage(data: any): Promise<void> {
    if (data instanceof ArrayBuffer) {
      const map = borc.decode(Buffer.from(data));
      this.emit('message', map);
    } else {
      this._ws!.close(WsCloseCode.UNSUPPORTED_DATA, 'text not supported');
    }
  }

  sendEvent(event: string, data: any): Promise<void> {
    const buf = borc.encode({
      event,
      ...data
    });
    return this.send(buf);
  }

  sendId(id: number, data: any): Promise<void> {
    const buf = borc.encode({
      id,
      ...data
    });
    return this.send(buf);
  }

  private async send(data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.isOpen) return reject(new DisconnectedError());
      this._ws!.send(data, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export interface PromiseLike {
  resolve: (value?: any) => void;
  reject: (err?: any) => void;
}
