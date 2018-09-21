import * as assert from 'assert';
import { EventEmitter } from 'events';
import { PeerType, RpcCodec, RpcPayload } from 'godcoin-neon';
import * as net from 'net';
import { DisconnectedError } from './errors';

export abstract class Net extends EventEmitter {

  get socket(): net.Socket|undefined {
    return this._socket;
  }

  set socket(socket: net.Socket|undefined) {
    if (socket) {
      this.codec = new RpcCodec();

      socket.on('open', this.onOpen.bind(this));
      socket.on('close', this.onClose.bind(this));
      socket.on('data', this.onData.bind(this));
      socket.on('error', this.onError.bind(this));
    } else if (this._socket) {
      this._socket.end();
      this._socket.removeAllListeners();
    }
    this._socket = socket;
  }

  get isOpen(): boolean {
    return this._socket !== undefined;
  }

  get peerType(): PeerType {
    return this._peerType!;
  }

  set peerType(t: PeerType) {
    assert(this.peerType === undefined, 'client type already set');
    this._peerType = t;
  }

  private _peerType?: PeerType;
  private _socket?: net.Socket;
  private codec?: RpcCodec;

  constructor(readonly nodeUrl: string) {
    super();
  }

  async send(rpc: RpcPayload): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.isOpen) return reject(new DisconnectedError());
      const buf = this.codec!.encode(rpc);
      this._socket!.write(buf, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  formatLogPrefix() {
    return `[${this.nodeUrl} (${this.isServerSide() ? 'incoming' : 'outgoing'})]`;
  }

  protected abstract isServerSide(): boolean;
  protected abstract onError(err: any): void;

  protected onOpen(): void {
    if (this.peerType === undefined && !this.isServerSide()) {
      console.log(`${this.formatLogPrefix()} Peer type not set`);
      this._socket!.end();
      return;
    }
    console.log(`${this.formatLogPrefix()} Peer has connected`);
    this.emit('open');
  }

  protected onClose(): void {
    console.log(`${this.formatLogPrefix()} Peer has disconnected`);
    this.socket = undefined;
    this.emit('close');
  }

  protected async onData(data: Buffer): Promise<void> {
    this.codec!.update(data);
    let payload;
    // tslint:disable-next-line no-conditional-assignment
    while (payload = this.codec!.decode()) {
      this.emit('message', payload);
    }
  }
}
