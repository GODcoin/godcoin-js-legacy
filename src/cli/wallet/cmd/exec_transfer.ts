import * as assert from 'assert';
import { Asset, AssetSymbol, PublicKey } from 'godcoin-neon';
import {
  TransferTx,
  TxType
} from '../../../lib';
import { Util } from '../util';
import { Wallet } from '../wallet';
import { write } from '../writer';

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
  const totalFee = await Util.getTotalFee(wallet.client, acc[0]);

  let fee: Asset;
  if (amt.symbol === AssetSymbol.GOLD) fee = totalFee.fee[0];
  else if (amt.symbol === AssetSymbol.SILVER) fee = totalFee.fee[1];
  assert(fee!, 'unhandled asset type: ' + amt.symbol);

  const props = await wallet.client.getProperties();
  const tx = new TransferTx({
    type: TxType.TRANSFER,
    timestamp: new Date(),
    from: acc[0],
    to: toAddr,
    amount: amt,
    fee: fee!,
    memo: Buffer.from(memo),
    signature_pairs: []
  }).appendSign(acc);
  write('Broadcasting tx\n', tx.toString(), '\n');
  const buf = Buffer.from(tx.serialize(true).toBuffer());
  await wallet.client.broadcast(buf);

  const height = Number.parseInt(props.block_height);
  const data = await Util.findTx(wallet.client, height, tx);
  if (data) {
    write(data);
  } else {
    write('Unable to locate tx within expiry time');
  }
}
