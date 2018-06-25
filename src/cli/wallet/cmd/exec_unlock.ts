import { WalletState } from '../wallet_state';
import { WalletIndexProp } from '../db';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execUnlock(wallet: Wallet, args: any[]) {
  (wallet.rl as any).history.shift();
  if (wallet.state === WalletState.NEW) {
    write('Wallet is not initialized, create a new wallet with `new <password>`');
    return;
  } else if (wallet.state === WalletState.UNLOCKED) {
    write('Wallet is already unlocked');
    return;
  }
  const pw = (args[1] || '').trim();
  if (!pw) return write('unlock <password> - missing password');
  wallet.db.setPassword(pw);

  try {
    const msg = await wallet.db.getProp(WalletIndexProp.INITIALIZED);
    if (msg !== 'hello') {
      return write('Failed to unlock wallet, incorrect password');
    }
    wallet.state = WalletState.UNLOCKED;
    wallet.rl.setPrompt('unlocked>> ');
  } catch (e) {
    if (e.message === 'wrong secret key for the given ciphertext') {
      write('Failed to unlock wallet, incorrect password');
      wallet.db.lock();
      return;
    }
    throw e;
  }
}
