import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execGetBlockRange(wallet: Wallet, args: any[]) {
  const minHeight = Number((args[1] || '').trim());
  const maxHeight = Number((args[2] || '').trim());
  if (isNaN(minHeight) || isNaN(maxHeight)) {
    write('get_block_range <min_height> <max_height> - missing or invalid number for min and max heights');
    return;
  }

  const data = await wallet.client.getBlockRange(minHeight, maxHeight);
  const blocks: string[] = [];
  for (const block of data.blocks) {
    blocks.push(JSON.parse(block.toString()));
  }
  write(JSON.stringify({
    range_outside_height: data.range_outside_height,
    blocks
  }, undefined, 2));
}
