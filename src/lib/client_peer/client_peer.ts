import { ClientNet } from './net';
import * as WebSocket from 'uws';

export class ClientPeer {

  constructor(readonly net: ClientNet) {}

}
