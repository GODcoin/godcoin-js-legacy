import { Asset, PublicKey, Tx } from 'godcoin-neon';
import { ClientPeer, GODcoin } from '../../lib';

export namespace Util {
  export interface TxRef {
    ref_block: number;
    ref_tx_pos: number;
  }

  export function getTotalFee(client: ClientPeer, addr: PublicKey): Promise<[Asset, Asset]> {
    return client.getTotalFee(addr);
  }

  export async function findTx(client: ClientPeer,
                               height: number,
                               tx: Tx): Promise<TxRef|undefined> {
    const buf = tx.encodeWithSigs();
    const exp = tx.timestamp.getTime() + GODcoin.TX_EXPIRY_TIME;
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
        const txBuf = blockTx.encodeWithSigs();
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
