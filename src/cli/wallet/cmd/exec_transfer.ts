import {
  AssetSymbol,
  TransferTx,
  PublicKey,
  TxType,
  Asset
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
  if (amt.symbol === AssetSymbol.GOLD) fee = totalFee[0];
  else if (amt.symbol === AssetSymbol.SILVER) fee = totalFee[1];
  assert(fee!, 'unhandled asset type: ' + amt.symbol);

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
  const data = await wallet.client.broadcast(buf);
  write(data);
}
