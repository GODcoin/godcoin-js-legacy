import { SignedBlock, Blockchain } from '../blockchain';
import { ClientPeerPool } from './client_peer_pool';
import { Producer, TxPool } from '../producer';
import { EndOfClients } from '../net';
import { Lock } from '../lock';
import * as Long from 'long';

export class Synchronizer {

  private running: boolean;
  private lock = new Lock();

  constructor(readonly blockchain: Blockchain,
              readonly peerPool: ClientPeerPool,
              readonly txPool: TxPool,
              readonly producer: Producer) {
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (this.peerPool.count <= 0) return;
    await this.synchronizeChain();
    const height = this.blockchain.head.height;
    console.log('Synchronization completed at height', height.toString());

    this.peerPool.on('open', async () => {
      if (this.running) {
        console.log('Resuming synchronization...');
        await this.synchronizeChain();
        console.log('Synchronized at height', this.blockchain.head.height.toString());
      }
    });

    this.peerPool.on('close', async () => {
      try {
        await this.lock.lock();
        if (this.running) {
          console.log('Synchronization paused until more clients are connected in the peer pool');
        }
      } finally {
        this.lock.unlock();
      }
    });
  }

  async stop() {
    this.running = false;
  }

  async handleBlock(block: SignedBlock) {
    if (!this.running) return;
    await this.lock.lock();
    try {
      const height = block.height.toString();
      const len = block.transactions.length;
      if (block.height.gt(this.blockchain.head.height)) {
        await this.producer.onBlock(block);
        console.log(`Received block at height ${height} with ${len} transaction${len === 1 ? '' : 's'}`);
      }
    } catch (e) {
      console.log('Failed to process incoming block', e);
    } finally {
      this.lock.unlock();
    }
  }

  async handleTx(tx: Buffer) {
    if (!this.running) return;
    await this.lock.lock();
    try {
      if (await this.blockchain.indexer.hasTx(tx)) return;
      await this.txPool.push(tx);
    } catch (e) {
      console.log('Failed to process incoming tx', e);
    } finally {
      this.lock.unlock();
    }
  }

  private async synchronizeChain(): Promise<void> {
    try {
      if (!this.running) return;
      await this.lock.lock();
      let height = this.blockchain.head ? this.blockchain.head.height : undefined;
      let batch = this.blockchain.prepareBatch();
      while (this.running) {
        try {
          const min = height ? height.add(1) : Long.fromNumber(0, true);
          const max = height ? height.add(100) : min.add(100);
          const range = await this.peerPool.getBlockRange(min.toNumber(), max.toNumber());
          height = max;

          if (range.blocks.length) {
            for (const block of range.blocks) {
              if (!this.running) break;
              if (this.blockchain.head) this.blockchain.validateBlock(block, this.blockchain.head);
              await batch.index(block);
            }
          }
          if (range.range_outside_height) break;
        } catch (e) {
          if (e instanceof EndOfClients) {
            await new Promise(r => setTimeout(r, 3000).unref());
            continue;
          }
          await batch.flush();
          throw e;
        }
      }
      await batch.flush();
      await this.blockchain.reload();
    } catch (e) {
      console.log('Failed to synchronize blockchain', e);
    } finally {
      this.lock.unlock();
    }
  }
}
