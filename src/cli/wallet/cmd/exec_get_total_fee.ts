import { PublicKey } from '../../../lib';
import { Wallet } from '../wallet';
import { write } from '../writer';
import { Util } from '../util';

export async function execGetTotalFee(wallet: Wallet, args: any[]) {
  let address = (args[1] || '').trim();
  if (!address) {
    write('get_total_fee <address|account> - missing address or account');
    return;
  } else if (await wallet.db.hasAccount(address)) {
    const acc = await wallet.db.getAccount(address);
    address = acc.publicKey.toWif();
  }

  // Make sure the user can't accidentally input a private key
  const addr = PublicKey.fromWif(address);
  const fee = await Util.getTotalFee(wallet.client, addr);
  write([
    fee[0].toString(),
    fee[1].toString()
  ]);
}

