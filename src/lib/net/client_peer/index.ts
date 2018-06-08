import { ClientNet } from './net';
import { Peer } from '../peer';

export * from './net';

export class ClientPeer extends Peer {

  constructor(readonly net: ClientNet) {
    super(net);
  }

  start(): Promise<boolean> {
    return this.net.start();
  }

  stop(): Promise<void> {
    return this.net.stop();
  }
}
