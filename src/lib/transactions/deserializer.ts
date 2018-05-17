import {
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../serializer';
import { Tx, TxType, TxData } from './transaction';
import { TransferTx } from './transfer';
import { RewardTx } from './reward';
import * as assert from 'assert';
import { BondTx } from './bond';

export function deserialize<T extends Tx>(buf: ByteBuffer, includeSigs = true): T {
  const txData = deserializePartial(buf, includeSigs);
  let tx: Tx|undefined;
  if (txData.type === TxType.REWARD) {
    tx = new RewardTx(RewardTx.deserialize(buf, txData));
  } else if (txData.type === TxType.TRANSFER) {
    tx = new TransferTx(TransferTx.deserialize(buf, txData));
  } else if (txData.type === TxType.BOND) {
    tx = new BondTx(BondTx.deserialize(buf, txData));
  }
  assert(tx, 'unhandled type: ' + txData.type);
  return tx as any;
}

function deserializePartial(buf: ByteBuffer, includeSigs: boolean) {
  let sigs: any[];
  if (includeSigs) sigs = TD.array(TS.sigPair)(buf);
  else sigs = [];

  const tx: TxData = Tx.DESERIALIZER(buf);
  tx.signature_pairs = sigs;
  return tx;
}
