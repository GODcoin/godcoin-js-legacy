import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execRemoveAccount(wallet: Wallet, args: any[]) {
  const name = (args[1] || '').trim();
  if (!name) return write('remove_account <name> - missing name');
  if (!(await wallet.db.hasAccount(name))) return write('Account does not exist');
  wallet.db.deleteAccount(name);
}
