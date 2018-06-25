import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execListAccounts(wallet: Wallet, args: any[]) {
  const accs = await wallet.db.getAllAccounts();
  write(accs.reduce((prev, val) => {
    prev[val[0]] = val[1].publicKey.toWif();
    return prev;
  }, {}));
}
