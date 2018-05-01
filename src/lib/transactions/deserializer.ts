import {
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../serializer';
import { TransferTx, TransferTxData } from './transfer';
import { Tx, TxType, TxData } from './transaction';
import { RewardTx, RewardTxData } from './reward';
import * as assert from 'assert';

export function deserialize<T extends Tx>(buf: ByteBuffer, includeSigs = true): T {
  const txData = deserializePartial(buf, includeSigs);
  let tx: Tx|undefined;
  if (txData.type === TxType.REWARD) {
    Object.assign(txData, RewardTx.deserialize(buf));
    tx = new RewardTx(txData as RewardTxData);
  } else if (txData.type === TxType.TRANSFER) {
    Object.assign(txData, TransferTx.deserialize(buf));
    tx = new TransferTx(txData as TransferTxData);
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
