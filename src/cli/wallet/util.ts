import { Asset, ClientPeer, GODcoin, PublicKey, Tx } from '../../lib';

export namespace Util {
  export interface TotalFee {
    net_fee: [Asset, Asset];
    fee: [Asset, Asset];
  }

  export interface TxRef {
    ref_block: number;
    ref_tx_pos: number;
  }

  export async function getTotalFee(client: ClientPeer, addr: PublicKey): Promise<TotalFee> {
    const fee = await client.getTotalFee(addr.toWif());
    return {
      net_fee: [
        Asset.fromString(fee.net_fee[0]),
        Asset.fromString(fee.net_fee[1])
      ],
      fee: [
        Asset.fromString(fee.fee[0]),
        Asset.fromString(fee.fee[1])
      ]
    };
  }

  export async function findTx(client: ClientPeer,
                               height: number,
                               tx: Tx): Promise<TxRef|undefined> {
    const buf = Buffer.from(tx.serialize(true).toBuffer());
    const exp = tx.data.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME;
    const hex = buf.toString('hex');
    let ref: TxRef|undefined;
    loop: while (Date.now() < exp) {
      const block = await client.getBlock(++height);
      if (!block) {
        await new Promise(r => setTimeout(r, GODcoin.BLOCK_PROD_TIME));
        --height;
        continue;
      }
      for (let i = 0; i < block.transactions.length; ++i) {
        const blockTx = block.transactions[i];
        const txBuf = Buffer.from(blockTx.serialize(true).toBuffer());
        if (hex === txBuf.toString('hex')) {
          ref = {
            ref_block: height,
            ref_tx_pos: i
          };
          break loop;
        }
      }
    }
    return ref;
  }
}
