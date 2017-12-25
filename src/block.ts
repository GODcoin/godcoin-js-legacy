import { Tx } from './transactions';

export interface BlockOpts {
  height: number;
  previous_hash: string;
  timestamp: string;
  transaction_merkle_root: string;
  transactions: Tx[]; // TODO: use strict typing
  signature: string;
  signing_key: string;
}

export class Block {

  constructor(readonly data: BlockOpts) {
  }

  isValid(): boolean {

    return false;
  }
}

export class InvalidBlock extends Error {
  constructor(msg?: string) {
    super(msg);
  }
}
