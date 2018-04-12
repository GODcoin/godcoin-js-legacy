import {
  TypeDeserializer as TD,
  TypeSerializer as TS
} from '../serializer';
import { TransferTx, TransferTxData } from './transfer';
import { RewardTx, RewardTxData } from './reward';
import { Tx, TxType } from './transaction';
import * as assert from 'assert';

export function deserialize<T>(buf: ByteBuffer, includeSigs = true): T {
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
  if (!includeSigs) txData.signatures = [];
  return tx as any;
}

function deserializePartial(buf: ByteBuffer, includeSigs: boolean) {
  const tx: any = {};
  if (includeSigs) {
    tx.signatures = TD.array(TS.buffer)(buf);
  }
  return Object.assign(tx, Tx.DESERIALIZER(buf));
}
