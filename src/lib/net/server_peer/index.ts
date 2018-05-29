import { ServerNet } from './net';

export * from './net';

export class ServerPeer {
  constructor(readonly net: ServerNet) {
  }

  init() {
    this.net.init();
  }
}
