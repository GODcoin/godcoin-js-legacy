import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execListAllKeys(wallet: Wallet, args: any[]) {
  const accs = await wallet.db.getAllAccounts();
  write(accs.reduce((prev, val) => {
    prev[val[0]] = {
      privateKey: val[1][1].toWif(),
      publicKey: val[1][0].toWif()
    };
    return prev;
  }, {}));
}
