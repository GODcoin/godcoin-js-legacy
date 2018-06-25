import { generateKeyPair } from '../../../lib';
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
  const keypair = generateKeyPair();
  await wallet.db.setAccount(name, keypair.privateKey);
  write({
    private_key: keypair.privateKey.toWif(),
    public_key: keypair.publicKey.toWif()
  });
}
