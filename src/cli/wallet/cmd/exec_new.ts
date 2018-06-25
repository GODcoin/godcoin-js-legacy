import { WalletState } from '../wallet_state';
import { WalletIndexProp } from '../db';
import { Wallet } from '../wallet';
import { write } from '../writer';
import * as assert from 'assert';

export async function execNew(wallet: Wallet, args: any[]) {
  (wallet.rl as any).history.shift();
  if (wallet.state === WalletState.UNLOCKED) {
    return write('Wallet already unlocked');
  } else if (wallet.state === WalletState.LOCKED) {
    return write('Wallet already exists, use `unlock <password>`');
  } else if (wallet.state !== WalletState.NEW) {
    return write('Unknown wallet state:', wallet.state);
  }

  const pw = (args[1] || '').trim();
  if (!pw) return write('new <password> - missing password');

  wallet.db.setPassword(pw);
  await wallet.db.setProp(WalletIndexProp.INITIALIZED, 'hello');
  const msg = await wallet.db.getProp(WalletIndexProp.INITIALIZED);
  assert.equal(msg, 'hello', 'failed to decrypt during encryption test');

  wallet.state = WalletState.LOCKED;
  wallet.db.lock();
  wallet.rl.setPrompt('locked>> ');
}
