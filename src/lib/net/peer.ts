import { Blockchain, SignedBlock } from '../blockchain';
import { TxPool, LocalMinter } from '../producer';
import * as ByteBuffer from 'bytebuffer';
import * as rpc from './rpc_model';
import { Net } from './net';

export class Peer {

  constructor(readonly net: Net) {}

  async broadcast(tx: Buffer): Promise<rpc.BroadcastResult> {
    return await this.net.invokeRpc({
      method: 'broadcast',
      tx
    });
  }

  async subscribeTx(): Promise<void> {
    await this.net.invokeRpc({
      method: 'subscribe_tx'
    });
  }

  async subscribeBlock(): Promise<SignedBlock> {
    const data = (await this.net.invokeRpc({
      method: 'subscribe_block'
    })).block;
    return SignedBlock.fullyDeserialize(ByteBuffer.wrap(data));
  }

  async getProperties(): Promise<rpc.NetworkProperties> {
    return await this.net.invokeRpc({
      method: 'get_properties'
    });
  }

  async getBlock(height: number): Promise<SignedBlock|undefined> {
    const data = await this.net.invokeRpc({
      method: 'get_block',
      height
    });
    if (!data.block) return;
    const buf = ByteBuffer.wrap(data.block);
    return SignedBlock.fullyDeserialize(buf);
  }

  async getBlockRange(minHeight: number, maxHeight: number): Promise<rpc.BlockRange> {
    const data = await this.net.invokeRpc({
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
    return (await this.net.invokeRpc({
      method: 'get_balance',
      address
    })).balance;
  }

  async getTotalFee(address: string): Promise<[string,string]> {
    return (await this.net.invokeRpc({
      method: 'get_total_fee',
      address
    })).fee;
  }

}
