import { doubleSha256, PublicKey, PrivateKey, KeyPair } from '../crypto';
import { TypeSerializer as TS } from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { Tx } from '../transactions';
import * as assert from 'assert';
import * as Long from 'long';
import * as bs58 from 'bs58';

export interface BlockOpts {
  height: Long;
  previous_hash: string;
  timestamp: Date;
  transactions: Tx[];
  tx_merkle_root?: string;
}

export interface SignedBlockOpts extends BlockOpts {
  signature: string;
  signing_key: PublicKey;
}

export class Block implements BlockOpts {

  readonly height: Long;
  readonly previous_hash: string;
  readonly timestamp: Date;
  readonly transactions: Tx[];
  readonly tx_merkle_root: string;

  constructor(data: BlockOpts) {
    this.height = data.height;
    this.previous_hash = data.previous_hash;
    this.timestamp = data.timestamp;
    this.transactions = data.transactions;
    if (data.tx_merkle_root) {
      this.tx_merkle_root = data.tx_merkle_root;
    } else {
      this.tx_merkle_root = this.getMerkleRoot();
    }
  }

  sign(keys: KeyPair): SignedBlock {
    const serialized = this.serialize();
    return new SignedBlock({
      height: this.height,
      previous_hash: this.previous_hash,
      timestamp: this.timestamp,
      transactions: this.transactions,
      tx_merkle_root: this.tx_merkle_root,
      signature: bs58.encode(keys.privateKey.sign(serialized)),
      signing_key: keys.publicKey
    });
  }

  validate(prevBlock: Block): void {
    for (const tx of this.transactions) {
      tx.validate();
    }
    {
      const thisRoot = this.tx_merkle_root;
      const expectedRoot = this.getMerkleRoot();
      assert.strictEqual(thisRoot, expectedRoot, 'unexpected merkle root');
    }
  }

  getHash(): string {
    const serialized = this.serialize();
    return doubleSha256(serialized).toString('hex');
  }

  serialize(): Buffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    TS.object([
      ['height', TS.uint64],
      ['previous_hash', TS.string],
      ['timestamp', TS.date],
      ['tx_merkle_root', TS.string]
    ])(buf, this);
    return Buffer.from(buf.flip().toBuffer());
  }

  private getMerkleRoot(): string {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    for (const tx of this.transactions) {
      const txb = tx.serialize();
      buf.writeUint32(txb.limit);
      buf.append(tx.serialize());
    }
    const hash = doubleSha256(Buffer.from(buf.flip().toBuffer()));
    return hash.toString('hex');
  }

  static createBlock(prevBlock: SignedBlock, tx: Tx[]): Block {
    return new Block({
      height: prevBlock.height.add(1),
      previous_hash: prevBlock.getHash(),
      timestamp: new Date(),
      transactions: tx
    });
  }
}

export class SignedBlock extends Block implements SignedBlockOpts {

  readonly signature: string;
  readonly signing_key: PublicKey;

  constructor(data: SignedBlockOpts) {
    super(data);
    this.signature = data.signature;
    this.signing_key = data.signing_key;
  }

  validate(prevBlock: Block) {
    super.validate(prevBlock);
    {
      const prevSerialized = prevBlock.serialize();
      const prevHash = doubleSha256(prevSerialized);
      const curHash = Buffer.from(this.previous_hash, 'hex');
      assert(prevHash.equals(curHash), 'previous hash does not match');
    }
    {
      const serialized = this.serialize();
      const sig = Buffer.from(bs58.decode(this.signature));
      assert(this.signing_key.verify(sig, serialized), 'invalid signature');
    }
  }
}
