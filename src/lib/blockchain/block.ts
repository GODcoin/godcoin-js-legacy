import {
  TypeDeserializer as TD,
  TypeSerializer as TS,
  ObjectType
} from '../serializer';
import { doubleSha256, PublicKey, PrivateKey, KeyPair } from '../crypto';
import { Tx, deserialize } from '../transactions';
import * as ByteBuffer from 'bytebuffer';
import * as assert from 'assert';
import * as Long from 'long';
import * as bs58 from 'bs58';

export interface BlockOpts {
  height: Long;
  previous_hash: Buffer;
  timestamp: Date;
  transactions: Tx[];
  tx_merkle_root?: Buffer;
}

export interface SignedBlockOpts extends BlockOpts {
  signature: Buffer;
  signing_key: PublicKey;
}

export class Block implements BlockOpts {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['height', TS.uint64],
    ['previous_hash', TS.buffer],
    ['timestamp', TS.date],
    ['tx_merkle_root', TS.buffer]
  ];
  static readonly SERIALIZER = TS.object(Block.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(Block.SERIALIZER_FIELDS);

  readonly height: Long;
  readonly previous_hash: Buffer;
  readonly timestamp: Date;
  readonly transactions: Tx[];
  readonly tx_merkle_root: Buffer;

  constructor(data: BlockOpts) {
    assert(data.height.unsigned);
    this.height = data.height;
    this.previous_hash = data.previous_hash;
    this.timestamp = new Date(Math.floor(data.timestamp.getTime() / 1000) * 1000);
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
      signature: keys.privateKey.sign(serialized),
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
      assert(expectedRoot.equals(thisRoot), 'unexpected merkle root');
    }
  }

  protected serialize(): Buffer {
    return Buffer.from(this.rawSerialize().flip().toBuffer());
  }

  protected rawSerialize(): ByteBuffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    Block.SERIALIZER(buf, this);
    return buf;
  }

  private getMerkleRoot(): Buffer {
    const buf = ByteBuffer.allocate(ByteBuffer.DEFAULT_CAPACITY,
                                    ByteBuffer.BIG_ENDIAN);
    for (const tx of this.transactions) {
      const txb = tx.serialize(true);
      buf.writeUint32(txb.limit);
      buf.append(txb);
    }
    return doubleSha256(Buffer.from(buf.flip().toBuffer()));
  }

  static create(prevBlock: SignedBlock, tx: Tx[]): Block {
    return new Block({
      height: prevBlock.height.add(1),
      previous_hash: prevBlock.getHash(),
      timestamp: new Date(),
      transactions: tx
    });
  }
}

export class SignedBlock extends Block implements SignedBlockOpts {

  static readonly SERIALIZER_FIELDS: ObjectType[] = [
    ['signing_key', TS.publicKey],
    ['signature', TS.buffer]
  ];
  static readonly SERIALIZER = TS.object(SignedBlock.SERIALIZER_FIELDS);
  static readonly DESERIALIZER = TD.object(SignedBlock.SERIALIZER_FIELDS);

  readonly signature: Buffer;
  readonly signing_key: PublicKey;

  constructor(data: SignedBlockOpts) {
    super(data);
    this.signature = data.signature;
    this.signing_key = data.signing_key;
  }

  validate(prevBlock: SignedBlock) {
    super.validate(prevBlock);
    {
      const prevHash = prevBlock.getHash();
      const curHash = this.previous_hash;
      assert(prevHash.equals(curHash), 'previous hash does not match');
    }
    {
      const serialized = this.serialize();
      assert(this.signing_key.verify(this.signature, serialized), 'invalid signature');
    }
  }

  fullySerialize(includeTx = true): ByteBuffer {
    const buf = super.rawSerialize();
    SignedBlock.SERIALIZER(buf, this);
    if (includeTx) {
      buf.writeUint32(this.transactions.length);
      for (const tx of this.transactions) {
        buf.append(tx.serialize(true));
      }
    }
    return buf.flip();
  }

  getHash(): Buffer {
    const serialized = Buffer.from(this.fullySerialize(false).toBuffer());
    return doubleSha256(serialized);
  }

  toString(): string {
    return JSON.stringify({
      height: this.height.toString(),
      previous_hash: this.previous_hash ? this.previous_hash.toString('hex') : undefined,
      timestamp: this.timestamp.toString(),
      transactions: this.transactions.map(val => {
        const data: any = {};
        Object.getOwnPropertyNames(val.data).forEach(name => {
          if (typeof(val.data[name]) !== 'function') {
            const prop = val.data[name];
            data[name] = prop !== undefined ? prop.toString() : undefined;
          }
        });
        return data;
      }),
      tx_merkle_root: this.tx_merkle_root.toString('hex'),
      signature: this.signature.toString('hex'),
      signingKey: this.signing_key.toWif()
    }, undefined, 2);
  }

  static fullyDeserialize(buf: ByteBuffer, includeTx = true): SignedBlock {
    const data = Block.DESERIALIZER(buf);
    Object.assign(data, SignedBlock.DESERIALIZER(buf));
    if (includeTx) {
      data.transactions = [];
      const len = buf.readUint32();
      for (let i = 0; i < len; ++i) {
        data.transactions.push(deserialize(buf, true));
      }
    }
    return new SignedBlock(data);
  }
}
