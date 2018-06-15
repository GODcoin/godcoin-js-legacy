import { Peer, PeerOpts } from '../peer';
import { ClientNet } from './net';

export * from './net';

export class ClientPeer extends Peer {

  constructor(opts: PeerOpts, readonly net: ClientNet) {
    super(opts, net);
  }

  start(): Promise<boolean> {
    return this.net.start();
  }

  async stop(): Promise<void> {
    await this.net.stop();
    this.removeAllListeners();
  }
}
