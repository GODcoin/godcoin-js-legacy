import { TypeSerializer as TS } from '../serializer';
import { Indexer, IndexProp } from '../indexer';
import * as ByteBuffer from 'bytebuffer';
import { SignedBlock } from './block';
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

  private blockTailPos = 0;

  private _blockHead!: SignedBlock;
  get blockHead(): SignedBlock {
    return this._blockHead;
  }

  private initialized = false;
  private lock = new Lock();
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
      const len = serBlock.byteLength;
      const tmp = Buffer.allocUnsafe(8);
      {
        // Write the block length
        tmp.writeUInt32BE(serBlock.byteLength, 0);
        await fsWrite(this.dbFd!, tmp, 0, 4);
      }
      await fsWrite(this.dbFd!, serBlock);

      const checksum = sha256(serBlock);
      await fsWrite(this.dbFd!, checksum, 0, 8);

      const str = block.height.toString();
      const val = Long.fromNumber(this.blockTailPos, true).toString();
      await this.index.setProp(getBlockPosString(str), val);
      await this.index.setProp(IndexProp.CURRENT_BLOCK_HEIGHT, str);

      this._blockHead = block;
      this.blockTailPos += len + 12;
    } finally {
      this.lock.unlock();
    }
  }

  async read(blockHeight: number|Long): Promise<SignedBlock|undefined> {
    let blockPos: number;
    try {
      blockPos = await this.index.getProp(getBlockPosString(blockHeight));
      blockPos = Long.fromString(blockPos as any, true).toNumber();
    } catch (e) {
      if (e.notFound) return;
      throw e;
    }

    try {
      const tmp = Buffer.allocUnsafe(8);

      // Read the length of the block
      let len: number;
      {
        const read = await fsRead(this.dbFd!, tmp, 0, 4, blockPos);
        assert.equal(read.bytesRead, 4, 'unexpected EOF');
        len = tmp.readUInt32BE(0);
      }

      // Read the block
      const buf = Buffer.allocUnsafe(len);
      let read = await fsRead(this.dbFd!, buf, 0, len, blockPos + 4);
      assert.equal(read.bytesRead, len, 'unexpected EOF');

      // Verify the checksum of the stored block
      {
        read = await fsRead(this.dbFd!, tmp, 0, 8, blockPos + len + 4);
        assert.equal(read.bytesRead, 8, 'unexpected EOF');
        assert(sha256(buf).slice(0, 8).equals(tmp), 'invalid checksum');
      }

      // Deserialize and return
      const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(buf));
      assert(block.height.eq(blockHeight));
      return block;
    } catch (e) {
      throw e;
    }
  }

  async init(): Promise<void> {
    assert(!this.initialized, 'already initialized');
    this.dbFd = await fsOpen(this.dbFile, 'a+');
    this.blockTailPos = (await fsStat(this.dbFile)).size;
    try {
      const height = await this.index.getProp(IndexProp.CURRENT_BLOCK_HEIGHT);
      const nHeight = Long.fromString(height, true);
      this._blockHead = (await this.read(nHeight))!;
      assert(this.blockHead, 'index points to an invalid block head');
    } catch (e) {
      if (!e.notFound) throw e;
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
    if (this.dbFd !== undefined) {
      await fsClose(this.dbFd);
      this.dbFd = undefined;
    }
  }
}

function getBlockPosString(blockNum: string|number|Long): string {
  return 'block_pos_' + (typeof(blockNum) !== 'string' ? blockNum.toString() : blockNum);
}

function sha256(val: Buffer) {
  return crypto.createHash('sha256').update(val).digest();
}
