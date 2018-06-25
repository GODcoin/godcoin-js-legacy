import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetBlock(wallet: Wallet, args: any[]) {
  const height = Number((args[1] || '').trim());
  if (height === NaN) {
    write('get_block <height> - missing or invalid number for height');
    return;
  }

  const block = await wallet.client.getBlock(height);
  if (block) write(block.toString());
  else write('Invalid block height');
}
