import { Block, SignedBlock } from './block';
import * as assert from 'assert';
export * from './block';

export class Blockchain {

  readonly blocks: SignedBlock[] = [];

  constructor(genesisBlock: SignedBlock) {
    assert(genesisBlock.height.eq(0));
    this.blocks.push(genesisBlock);
  }

  addBlock(block: SignedBlock) {
    assert(block.height.eq(this.blocks.length), 'unexpected height');
    block.validate(this.getLatestBlock());
    this.blocks.push(block);
  }

  getLatestBlock(): SignedBlock {
    return this.blocks[this.blocks.length - 1];
  }
}
