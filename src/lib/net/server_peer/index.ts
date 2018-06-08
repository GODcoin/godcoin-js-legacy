import { ServerNet } from './net';
import { Peer } from '../peer';

export * from './net';

export class ServerPeer extends Peer {

  constructor(readonly net: ServerNet) {
    super(net);
  }

  init() {
    this.net.init();
  }
}
