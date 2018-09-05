import * as assert from 'assert';
import * as newDebug from 'debug';
import { PublicKey, SignedBlock } from 'godcoin-neon';
import { Blockchain } from '../blockchain';
import { GODcoin } from '../constants';
import { Lock } from '../lock';
import { LocalMinter } from './local_minter';
import { Scheduler } from './scheduler';
import { TxPool } from './tx_pool';

const debug = newDebug('godcoin:producer');

export class Producer {

  readonly scheduler = new Scheduler();

  private readonly lock = new Lock();
  private _running = false;
  private initd = false;

  private timer?: NodeJS.Timer;
  private missed = 0;

  get running() { return this._running; }

  constructor(readonly blockchain: Blockchain,
              public txPool: TxPool,
              public minter?: LocalMinter) {
  }

  async start(forceLaterSchedule = false) {
    await this.lock.lock();
    try {
      if (this._running) return;
      this._running = true;

      if (!this.initd) {
        this.initd = true;
        await this.scheduler.init(this.blockchain.indexer);
      }

      this.startTimer(forceLaterSchedule);
    } finally {
      this.lock.unlock();
    }
  }

  async stop() {
    await this.lock.lock();
    try {
      this._running = false;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    } finally {
      this.lock.unlock();
    }
  }

  async onBlock(block: SignedBlock): Promise<boolean> {
    if (!this._running) return false;
    await this.lock.lock();
    try {
      const head = this.blockchain.head;
      const bond = this.scheduler.nextMinter(head, this.missed);
      const signer = block.sig_pair[0];
      if (!bond.minter.equals(signer)) {
        console.log(`[rejected block ${block.height.toString()}] \
Unexpected minter, dropped block from ${signer.toWif()}`);
        return false;
      }

      {
        const delta = block.timestamp.getTime() - head.timestamp.getTime();
        if (delta < GODcoin.BLOCK_PROD_TIME) {
          console.log(`[rejected block ${block.height.toString()}] Attempted \
to produce blocks too quickly from ${signer.toWif()}`);
          debug('head timestamp: %s, block timestamp %s, delta %j',
                  head.timestamp.toISOString(),
                  block.timestamp.toISOString(),
                  delta);
          return false;
        }
      }

      if (this.timer) clearTimeout(this.timer);
      await this.blockchain.addBlock(block);
      await this.postProduction();
      this.startTimer();
      return true;
    } catch (e) {
      console.log('Failed to handle incoming new block', e);
      return false;
    } finally {
      this.lock.unlock();
    }
  }

  private startTimer(forceLaterSchedule = false) {
    assert(this._running, 'producer must be running');
    if (this.timer) clearTimeout(this.timer);
    const head = this.blockchain.head;
    const next = head.timestamp.getTime() + GODcoin.BLOCK_PROD_TIME;
    let schedule: number;
    if (forceLaterSchedule) {
      schedule = GODcoin.BLOCK_PROD_TIME;
    } else {
      const lowerBound = Math.max(next - Date.now(), 0);
      schedule = Math.min(lowerBound, GODcoin.BLOCK_PROD_TIME);
    }

    debug('attempting to produce a block in %jms', schedule);
    this.timer = setTimeout(async () => {
      await this.tryProducingBlock();
    }, schedule);
  }

  private startMissedBlockTimer(minter: PublicKey, height: number) {
    this.timer = setTimeout(async () => {
      await this.lock.lock();
      if (this.blockchain.head.height !== height) {
        console.log(`Minter (${minter.toWif()}) missed block`);
        ++this.missed;
        debug('current missed counter is at %j', this.missed);
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
      if (this.minter && bond.minter.equals(this.minter.keys[0])) {
        await this.minter.produceBlock();
        await this.postProduction();
        this.startTimer();
      } else {
        this.startMissedBlockTimer(bond.minter, head.height + 1);
      }
    } catch (e) {
      console.log('Failed to produce a block', e);
      this.startMissedBlockTimer(bond.minter, head.height + 1);
    } finally {
      this.lock.unlock();
    }
  }

  private async postProduction() {
    // TODO: scan for left over transactions
    await this.txPool.popAll();
    this.missed = 0;
  }
}
