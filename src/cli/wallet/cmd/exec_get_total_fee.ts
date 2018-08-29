import { PublicKey } from 'godcoin-neon';
import { Util } from '../util';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetTotalFee(wallet: Wallet, args: any[]) {
  let address = (args[1] || '').trim();
  if (!address) {
    write('get_total_fee <address|account> - missing address or account');
    return;
  } else if (await wallet.db.hasAccount(address)) {
    const acc = await wallet.db.getAccount(address);
    address = acc[0].toWif();
  }

  // Make sure the user can't accidentally input a private key
  const addr = PublicKey.fromWif(address);
  const fee = await Util.getTotalFee(wallet.client, addr);
  write({
    net_fee: [
      fee.net_fee[0].toString(),
      fee.net_fee[1].toString()
    ],
    fee: [
      fee.fee[0].toString(),
      fee.fee[1].toString()
    ]
  });
}
