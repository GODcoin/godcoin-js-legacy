import { ClientPeer, PublicKey, Asset } from '../../lib';

export namespace Util {
  export async function getTotalFee(client: ClientPeer, addr: PublicKey): Promise<[Asset,Asset]> {
    const fee = await client.getTotalFee(addr.toWif());
    return [
      Asset.fromString(fee[0]),
      Asset.fromString(fee[1])
    ];
  }
}
