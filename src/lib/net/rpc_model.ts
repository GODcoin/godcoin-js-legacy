import { SignedBlock } from 'godcoin-neon';

export interface BlockRange {
  range_outside_height: boolean;
  blocks: SignedBlock[];
}
