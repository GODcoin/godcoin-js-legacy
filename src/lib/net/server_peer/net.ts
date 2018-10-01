import * as assert from 'assert';
import { RpcMsgType, RpcPayload } from 'godcoin-neon';
import * as net from 'net';
import { PromiseLike } from '../../node-util';
import { Net } from '../net';

export type MessageCallback = (map: any) => Promise<any>;

export class ServerNet extends Net {

  private handshakePromise?: PromiseLike;

  constructor(nodeUrl: string, socket: net.Socket) {
    super(nodeUrl);
    this.socket = socket;
  }

  async init(): Promise<void> {
    // Handle handshake
    await new Promise((_resolve, _reject) => {
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

      const timer = setTimeout(() => {
        reject(new Error('handshake timeout'));
      }, 3000);

      this.once('message', (rpc: RpcPayload) => {
        if (rpc.id !== 0) {
          return reject(new Error('handshake id invalid'));
        } else if (rpc.msg_type !== RpcMsgType.HANDSHAKE) {
          return reject(new Error('message must be handshake type'));
        }
        this.peerType = rpc.req!.peer_type;
        assert(this.peerType !== undefined, 'expected peerType to be defined');
        try {
          this.send({
            id: 0,
            msg_type: RpcMsgType.NONE
          });
        } catch (e) {
          return reject(new Error('failed to send server handshake response'));
        }
        clearTimeout(timer);
        resolve();
      });
    });

    this.onOpen();
  }

  protected isServerSide() {
    return true;
  }

  protected onClose() {
    super.onClose();
    this.removeAllListeners();
    if (this.handshakePromise) {
      this.handshakePromise.reject(new Error('client disconnected during handshake'));
    }
  }

  protected onError(err: any): void {
    console.log(`[${this.nodeUrl}] Unexpected error`, err);
  }
}
