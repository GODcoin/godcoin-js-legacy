import { Peer, PeerOpts } from '../peer';
import { ServerNet } from './net';

export * from './net';

export class ServerPeer extends Peer {

  constructor(opts: PeerOpts, readonly net: ServerNet) {
    super(opts, net);
  }

  init() {
    this.net.init();
  }
}
