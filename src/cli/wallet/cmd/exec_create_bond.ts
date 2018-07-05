import { Asset, BondTx, GODcoin, TxType } from '../../../lib';
import { Util } from '../util';
import { Wallet } from '../wallet';
import { write } from '../writer';

export async function execCreateBond(wallet: Wallet, args: any[]) {
  const minter = (args[1] || '').trim();
  const staker = (args[2] || '').trim();
  const stakeAmt = (args[3] || '').trim();
  if (!(minter && staker)) {
    // tslint:disable-next-line:max-line-length
    write('create_bond <minter_account> <staker_account> <stake_amount> - missing minter_account, staker_account, or stake_amount');
    return;
  }

  const minterAcc = await wallet.db.getAccount(minter);
  if (!minterAcc) return write('Minter account does not exist');
  const stakerAcc = await wallet.db.getAccount(staker);
  if (!stakerAcc) return write('Staker account does not exist');

  const fee = (await Util.getTotalFee(wallet.client, stakerAcc.publicKey)).fee;

  const props = await wallet.client.getProperties();
  const tx = new BondTx({
    type: TxType.BOND,
    timestamp: new Date(),
    minter: minterAcc.publicKey,
    staker: stakerAcc.publicKey,
    stake_amt: Asset.fromString(stakeAmt),
    bond_fee: GODcoin.BOND_FEE,
    fee: fee[0],
    signature_pairs: []
  }).appendSign(minterAcc.privateKey)
    .appendSign(stakerAcc.privateKey);
  await wallet.client.broadcast(Buffer.from(tx.serialize(true).toBuffer()));
  write('Broadcasting tx\n', tx.toString(), '\n');
  const height = Number.parseInt(props.block_height);
  const data = await Util.findTx(wallet.client, height, tx);
  if (data) {
    write(data);
  } else {
    write('Unable to locate tx within expiry time');
  }
}
