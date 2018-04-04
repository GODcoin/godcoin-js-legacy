import { Lock } from '../src/lib/lock';
import { expect } from 'chai';

it('should lock and unlock', async () => {
  const lock = new Lock();
  await lock.lock();

  const promises: boolean[] = new Array(10).fill(false);
  for (let i = 0; i < promises.length; ++i) {
    await new Promise(async resolve => {
      resolve();
      await lock.lock();
      promises[i] = true;
    });
  }

  for (let o = 0; o < promises.length; ++o) {
    lock.unlock();
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i <= o; ++i) {
      expect(promises[i]).to.be.true;
    }
    for (let i = o + 1; i < promises.length; ++i) {
      expect(promises[i]).to.be.false;
    }
  }

  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < promises.length; ++i) {
    expect(promises[i]).to.be.true;
  }
  // The lock flag is still set as the unlock is called separately
  expect(lock.locked).to.be.true;
  lock.unlock();
  expect(lock.locked).to.be.false;
}).timeout(1000);
