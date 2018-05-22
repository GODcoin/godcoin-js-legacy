import { Blockchain, SignedBlock } from '../blockchain';
import { LocalMinter } from './local_minter';
import { Scheduler } from './scheduler';
import { GODcoin } from '../constants';
import { Indexer, IndexProp } from '../indexer';
import * as assert from 'assert';
import { Lock } from '../lock';
import { PublicKey } from '../crypto';
import * as sodium from 'libsodium-wrappers';
import { Asset } from '..';

export class Producer {

  readonly scheduler = new Scheduler();

  private readonly lock = new Lock();
  private running = false;
  private initd = false;

  private readonly indexer: Indexer;
  private timer?: NodeJS.Timer;
  private missed = 0;

  constructor(readonly blockchain: Blockchain,
              public minter?: LocalMinter) {
    this.indexer = blockchain.indexer;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    if (this.initd) return;
    this.initd = true;
    await new Promise((resolve, reject) => {
      this.blockchain.indexer.db.createReadStream({
        gte: IndexProp.NAMESPACE_BOND,
        lt: Buffer.from([IndexProp.NAMESPACE_BOND[0] + 1])
      }).on('data', data => {
        try {
          const key = data.key as Buffer;
          const value = data.value as Buffer;

          const minter = new PublicKey(key.slice(IndexProp.NAMESPACE_BOND.length));
          const staker = new PublicKey(value.slice(0, sodium.crypto_sign_PUBLICKEYBYTES));
          const amt = Asset.fromString(value.slice(sodium.crypto_sign_PUBLICKEYBYTES).toString('utf8'));
          this.scheduler.addBond({
            minter,
            staker,
            stake_amt: amt
          });
          console.log('Registered bond from minter:', minter.toWif());
        } catch (e) {
          console.log('Failed to register bond', e);
        }
      }).on('end', () => {
        resolve();
      }).on('error', err => {
        reject(err);
      });
    });
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async onBlock(block: SignedBlock): Promise<void> {
    if (!this.running) return;
    await this.lock.lock();
    try {
      const head = this.blockchain.head;
      const bond = this.scheduler.nextMinter(head, this.missed);
      const signer = block.signature_pair.public_key;
      if (!bond.minter.equals(signer)) {
        console.log('Unexpected minter, dropped block from', signer.toWif());
        return;
      }

      {
        const delta = block.timestamp.getTime() - head.timestamp.getTime();
        if (delta < GODcoin.BLOCK_PROD_TIME) {
          console.log('Attempted to produce blocks too quickly from', signer.toWif());
          return;
        }
      }

      if (this.timer) clearTimeout(this.timer);
      await this.blockchain.addBlock(block);
      this.missed = 0;
      this.startTimer();
    } catch (e) {
      console.log('Failed to handle incoming new block', e);
    } finally {
      this.lock.unlock();
    }
  }

  startTimer() {
    assert(this.running, 'producer must be running');
    if (this.timer) clearTimeout(this.timer);
    const head = this.blockchain.head;
    const next = head.timestamp.getTime() + GODcoin.BLOCK_PROD_TIME;
    const schedule = Math.min(Math.max(next - Date.now(), 0), GODcoin.BLOCK_PROD_TIME);

    this.timer = setTimeout(async () => {
      await this.tryProducingBlock();
    }, schedule);
  }

  private startMissedBlockTimer(minter: PublicKey, height: Long) {
    this.timer = setTimeout(async () => {
      await this.lock.lock();
      if (this.blockchain.head.height.neq(height)) {
        console.log(`Minter (${minter.toWif()}) missed block`);
        ++this.missed;
        this.tryProducingBlock();
      }
      this.lock.unlock();
    }, 1000);
  }

  private async tryProducingBlock() {
    await this.lock.lock();
    const head = this.blockchain.head;
    const bond = this.scheduler.nextMinter(head, this.missed);
    try {
      if (this.minter && bond.minter.equals(this.minter.keys.publicKey)) {
        await this.minter.produceBlock();
        this.startTimer();
      } else {
        this.startMissedBlockTimer(bond.minter, head.height.add(1));
      }
    } catch (e) {
      console.log('Failed to produce a block', e);
      this.startMissedBlockTimer(bond.minter, head.height.add(1));
    } finally {
      this.lock.unlock();
    }
  }
}
