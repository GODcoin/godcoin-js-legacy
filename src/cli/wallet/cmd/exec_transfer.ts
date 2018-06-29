import {
  AssetSymbol,
  TransferTx,
  PublicKey,
  TxType,
  Asset,
  GODcoin
} from '../../../lib';
import { Wallet } from '../wallet';
import { write } from '../writer';
import * as assert from 'assert';
import { Util } from '../util';

export async function execTransfer(wallet: Wallet, args: any[]) {
  const accountStr = (args[1] || '').trim();
  const toAddrStr = (args[2] || '').trim();
  const amtStr = (args[3] || '').trim();
  const memo = (args[4] || '').trim();
  if (!(accountStr && toAddrStr && amtStr)) {
    write('transfer <from_account> <to_address> <amount> [memo] - missing from_account, to_address, or amount');
    return;
  }
  const acc = await wallet.db.getAccount(accountStr);
  if (!acc) return write('Account not found');

  const toAddr = PublicKey.fromWif(toAddrStr);
  const amt = Asset.fromString(amtStr);
  const totalFee = await Util.getTotalFee(wallet.client, acc.publicKey);

  let fee: Asset;
  if (amt.symbol === AssetSymbol.GOLD) fee = totalFee.fee[0];
  else if (amt.symbol === AssetSymbol.SILVER) fee = totalFee.fee[1];
  assert(fee!, 'unhandled asset type: ' + amt.symbol);

  const props = await wallet.client.getProperties();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    from: acc.publicKey,
    to: toAddr,
    amount: amt,
    fee: fee!,
    memo: Buffer.from(memo),
    signature_pairs: []
  }).appendSign(acc.privateKey);
  write('Broadcasting tx\n', tx.toString(), '\n');
  const buf = Buffer.from(tx.serialize(true).toBuffer());
  await wallet.client.broadcast(buf);

  let height = Number.parseInt(props.block_height);
  const exp = tx.data.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME;
  const hex = buf.toString('hex');
  while (Date.now() < exp) {
    const block = await wallet.client.getBlock(++height);
    if (!block) {
      await new Promise(r => setTimeout(r, GODcoin.BLOCK_PROD_TIME));
      --height;
      continue;
    }
    for (let i = 0; i < block.transactions.length; ++i) {
      const tx = block.transactions[i];
      if (hex === Buffer.from(tx.serialize(true).toBuffer()).toString('hex')) {
        write({
          ref_block: height,
          ref_tx_pos: i
        });
        return;
      }
    }
  }
  write('unable to locate tx within expiry time');
}
