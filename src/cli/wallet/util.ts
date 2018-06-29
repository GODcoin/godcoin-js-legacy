import { ClientPeer, PublicKey, Asset } from '../../lib';

export namespace Util {
  export interface TotalFee {
    net_fee: [Asset, Asset];
    fee: [Asset, Asset];
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
}
