import { SignedBlock } from '../blockchain';

export interface BroadcastResult {
  ref_block: string;
  ref_tx_pos: number;
}

export interface NetworkProperties {
  block_height: string;
  network_fee: [ string /* gold */, string /* silver */ ];
}

export interface BlockRange {
  range_outside_height: boolean;
  blocks: SignedBlock[];
}
