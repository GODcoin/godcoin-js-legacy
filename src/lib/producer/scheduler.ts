import { SignedBlock } from '../blockchain';
import { PublicKey } from '../crypto';
import { Bond } from '../transactions';

export class Scheduler {

  private bonds: Bond[] = [];

  addBond(bond: Bond) {
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
