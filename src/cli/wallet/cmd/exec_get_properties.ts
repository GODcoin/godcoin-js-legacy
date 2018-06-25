import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetProperties(wallet: Wallet, args: any[]) {
  const data = await wallet.client.getProperties();
  write(data);
}
