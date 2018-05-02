import { SignedBlock } from '../blockchain';
import * as ByteBuffer from 'bytebuffer';
import { PublicKey } from '../crypto';
import { ClientNet } from './net';
import * as WebSocket from 'uws';
import { Asset } from '../asset';

export class ClientPeer {

  constructor(readonly net: ClientNet) {}

  open(): Promise<void> {
    return this.net.open();
  }

  close(): void {
    return this.net.close();
  }

  async broadcast(tx: Buffer): Promise<BroadcastResult> {
    return await this.net.send({
      method: 'broadcast',
      tx
    });
  }

  async getProperties(): Promise<NetworkProperties> {
    return await this.net.send({
      method: 'get_properties'
    });
  }

  async getBlock(height: number): Promise<SignedBlock|undefined> {
    const data = await this.net.send({
      method: 'get_block',
      height
    });
    if (!data.block) return;
    const buf = ByteBuffer.wrap(data.block);
    return SignedBlock.fullyDeserialize(buf);
  }

  async getBlockRange(minHeight: number, maxHeight: number): Promise<BlockRange> {
    const data = await this.net.send({
      method: 'get_block_range',
      min_height: minHeight,
      max_height: maxHeight
    });

    const blocks: SignedBlock[] = [];
    for (const block of data.blocks) {
      const buf = ByteBuffer.wrap(block);
      blocks.push(SignedBlock.fullyDeserialize(buf));
    }
    return {
      range_outside_height: data.range_outside_height,
      blocks
    };
  }

  async getBalance(address: string): Promise<[string,string]> {
    return (await this.net.send({
      method: 'get_balance',
      address
    })).balance;
  }

  async getTotalFee(address: string): Promise<[string,string]> {
    return (await this.net.send({
      method: 'get_total_fee',
      address
    })).fee;
  }
}

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
