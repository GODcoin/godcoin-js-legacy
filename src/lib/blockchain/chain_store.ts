import { TypeSerializer as TS } from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { SignedBlock } from './block';
import { Indexer } from '../indexer';
import * as crypto from 'crypto';
import * as assert from 'assert';
import { Lock } from '../lock';
import * as path from 'path';
import * as util from 'util';
import * as Long from 'long';
import * as fs from 'fs';

const fsOpen = util.promisify(fs.open);
const fsClose = util.promisify(fs.close);
const fsUnlink = util.promisify(fs.unlink);
const fsExists = util.promisify(fs.exists);
const fsWrite = util.promisify(fs.write);
const fsRead = util.promisify(fs.read);
const fsStat = util.promisify(fs.stat);

export class ChainStore {

  private readonly lock = new Lock();
  private blockTailPos = 0;

  private _blockHead!: SignedBlock;
  get blockHead(): SignedBlock {
    return this._blockHead;
  }

  private initialized = false;
  private dbFd?: number;

  readonly index: Indexer;
  readonly dbFile: string;

  constructor(dbFile: string, index: Indexer) {
    this.dbFile = dbFile;
    this.index = index;
  }

  async write(block: SignedBlock): Promise<void> {
    await this.lock.lock();
    try {
      if (!this._blockHead) {
        assert(block.height.eq(0), 'New db must start with genesis block');
      }

      const serBlock = Buffer.from(block.fullySerialize(true).toBuffer());
      const blockLen = serBlock.length;
      {
        // Write the block length
        const tmp = Buffer.allocUnsafe(8);
        const len = Long.fromNumber(blockLen, true);
        tmp.writeInt32BE(len.high, 0, true);
        tmp.writeInt32BE(len.low, 4, true);
        await fsWrite(this.dbFd!, tmp, 0, 8);
      }
      await fsWrite(this.dbFd!, serBlock);

      const checksum = sha256(serBlock);
      await fsWrite(this.dbFd!, checksum, 0, 8);

      const val = Long.fromNumber(this.blockTailPos, true);
      await this.index.setBlockPos(block.height, val);
      await this.index.setBlockHeight(block.height);

      this._blockHead = block;
      this.blockTailPos += blockLen + 16; // checksum + blockLen
    } finally {
      this.lock.unlock();
    }
  }

  async read(blockHeight: number|Long): Promise<SignedBlock|undefined> {
    if (typeof(blockHeight) === 'number') {
      blockHeight = Long.fromNumber(blockHeight, true);
    }
    const pos = await this.index.getBlockPos(blockHeight) as any;
    if (!pos) return;

    const block = await this.readBlock(pos.toNumber());
    assert(block[0].height.eq(blockHeight));
    return block[0];
  }

  async readBlockLog(cb: (block: SignedBlock, bytePos: number) => void): Promise<void> {
    let blockPos = 0;
    while (blockPos < this.blockTailPos) {
      const block = await this.readBlock(blockPos);
      await cb(block[0], blockPos);
      blockPos += block[1];
    }
  }

  async init(): Promise<void> {
    assert(!this.initialized, 'already initialized');
    this.dbFd = await fsOpen(this.dbFile, 'a+');
    this.blockTailPos = (await fsStat(this.dbFile)).size;
    this.initialized = true;
    await this.reload();
  }

  async reload(): Promise<void> {
    assert(this.initialized, 'must be initialized to reload');
    const height = await this.index.getBlockHeight();
    if (height) {
      this._blockHead = (await this.read(height))!;
      assert(this._blockHead, 'index points to an invalid block head');
    }
  }

  async close(): Promise<void> {
    await this.lock.lock();
    try {
      this.initialized = false;
      if (this.dbFd !== undefined) {
        await fsClose(this.dbFd);
        this.dbFd = undefined;
      }
    } finally {
      this.lock.unlock();
    }
  }

  private async readBlock(blockPos: number): Promise<[SignedBlock,number]> {
    const tmp = Buffer.allocUnsafe(8);

    // Read the length of the block
    let len: number;
    {
      const read = await fsRead(this.dbFd!, tmp, 0, 8, blockPos);
      assert.equal(read.bytesRead, 8, 'unexpected EOF');
      const high = tmp.readInt32BE(0, true);
      const low = tmp.readInt32BE(4, true);
      len = new Long(low, high, true).toNumber();
    }

    // Read the block
    const buf = Buffer.allocUnsafe(len);
    let read = await fsRead(this.dbFd!, buf, 0, len, blockPos + 8);
    assert.equal(read.bytesRead, len, 'unexpected EOF');

    // Verify the checksum of the stored block
    {
      read = await fsRead(this.dbFd!, tmp, 0, 8, blockPos + len + 8);
      assert.equal(read.bytesRead, 8, 'unexpected EOF');
      assert(sha256(buf).slice(0, 8).equals(tmp), 'invalid checksum');
    }

    // Deserialize and return
    const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(buf));
    return [block, len + 16];
  }
}

function sha256(val: Buffer) {
  return crypto.createHash('sha256').update(val).digest();
}
