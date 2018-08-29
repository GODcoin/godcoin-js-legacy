import { PublicKey } from 'godcoin-neon';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetBalance(wallet: Wallet, args: any[]) {
  let address = (args[1] || '').trim();
  if (!address) {
    write('get_balance <address|account> - missing address or account');
    return;
  } else if (await wallet.db.hasAccount(address)) {
    const acc = await wallet.db.getAccount(address);
    address = acc[0].toWif();
  }

  // Make sure the user can't accidentally input a private key
  PublicKey.fromWif(address);

  const balance = await wallet.client.getBalance(address);
  write(balance);
}
