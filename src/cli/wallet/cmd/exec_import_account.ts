import { PrivateKey } from 'godcoin-neon';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execImportAccount(wallet: Wallet, args: any[]) {
  const name = (args[1] || '').trim();
  const pk = (args[2] || '').trim();
  if (!(name && pk)) {
    write('import_account <name> <private_key> - missing name or private key');
    return;
  } else if (await wallet.db.hasAccount(name)) {
    write('Account already exists');
    return;
  }

  const priv = PrivateKey.fromWif(pk);
  await wallet.db.setAccount(name, priv[1]);
}
