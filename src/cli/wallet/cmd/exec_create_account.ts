import { PrivateKey } from 'godcoin-neon';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execCreateAccount(wallet: Wallet, args: any[]) {
  const name = (args[1] || '').trim();
  if (!name) {
    write('create_account <name> - missing name');
    return;
  } else if (await wallet.db.hasAccount(name)) {
    write('Account already exists');
    return;
  }
  const keypair = PrivateKey.genKeyPair();
  await wallet.db.setAccount(name, keypair[1]);
  write({
    private_key: keypair[1].toWif(),
    public_key: keypair[0].toWif()
  });
}
