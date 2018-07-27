import { Asset } from 'godcoin-neon';
import * as sodium from 'libsodium-wrappers';
import { SignedBlock } from '../blockchain';
import { PublicKey } from '../crypto';
import { Indexer, IndexProp } from '../indexer';
import { Bond } from '../transactions';

export class Scheduler {

  private bonds: Bond[] = [];

  async init(indexer: Indexer) {
    await new Promise((resolve, reject) => {
      indexer.db.createReadStream({
        gte: IndexProp.NAMESPACE_BOND,
        lt: Buffer.from([IndexProp.NAMESPACE_BOND[0] + 1])
      }).on('data', data => {
        try {
          const key = data.key as Buffer;
          const value = data.value as Buffer;

          const minter = new PublicKey(key.slice(IndexProp.NAMESPACE_BOND.length));
          const staker = new PublicKey(value.slice(0, sodium.crypto_sign_PUBLICKEYBYTES));
          const amt = Asset.fromString(value.slice(sodium.crypto_sign_PUBLICKEYBYTES).toString('utf8'));
          const bond: Bond = {
            minter,
            staker,
            stake_amt: amt
          };
          if (!this.bonds.includes(bond)) {
            this.addBond(bond);
            console.log('Registered bond from minter:', minter.toWif());
          }
        } catch (e) {
          console.log('Failed to register bond', e);
        }
      }).on('end', () => {
        resolve();
      }).on('error', err => {
        reject(err);
      });
    });
  }

  addBond(bond: Bond) {
    if (this.bonds.includes(bond)) return;
    this.bonds.push(bond);
    this.bonds.sort((a, b) => a.minter.buffer.compare(b.minter.buffer));
  }

  removeBond(minter: PublicKey) {
    for (let i = 0; i < this.bonds.length; ++i) {
      if (this.bonds[i].minter.equals(minter)) {
        this.bonds.splice(i, 1);
        break;
      }
    }
  }

  nextMinter(head: SignedBlock, skip = 0): Bond {
    const index = head.height.add(skip).mod(this.bonds.length).toNumber();
    return this.bonds[index];
  }
}
