import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetProperties(wallet: Wallet, args: any[]) {
  const data = await wallet.client.getProperties();
  write({
    height: data.height,
    token_supply: [
      data.token_supply[0].toString(),
      data.token_supply[1].toString()
    ]
  });
}
