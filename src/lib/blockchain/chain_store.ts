import { TypeSerializer as TS } from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { SignedBlock } from './block';
import { Indexer } from '../indexer';
import * as crypto from 'crypto';
import * as assert from 'assert';
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
const fsTruncate = util.promisify(fs.truncate);

export class ChainStore {

  private blockTailPos = 0;

  private _blockHead!: SignedBlock;
  get blockHead(): SignedBlock {
    return this._blockHead;
  }

  private initialized = false;
  private dbFd?: number;

  private readonly blockCache = new BlockCache();
  readonly index: Indexer;
  readonly dbFile: string;

  constructor(dbFile: string, index: Indexer) {
    this.dbFile = dbFile;
    this.index = index;
  }

  async init(): Promise<void> {
    assert(!this.initialized, 'already initialized');
    this.dbFd = await fsOpen(this.dbFile, 'a+');
    this.blockTailPos = (await fsStat(this.dbFile)).size;
    this.initialized = true;
    await this.reload();
  }

  async reload(): Promise<void> {
    assert(this.initialized, 'must be initialized');
    const height = await this.index.getChainHeight();
    if (height) {
      this._blockHead = (await this.read(height))!;
      assert(this._blockHead, 'index points to an invalid block head');

      // Fill the block cache
      let min = height.sub(BlockCache.MAX_CACHE_SIZE);
      if (min.lt(0)) min = Long.fromNumber(0, true);
      for (; min.lte(height); min = min.add(1)) {
        this.blockCache.push((await this.read(min))!);
      }
    }
  }

  async chop(height: Long): Promise<void> {
    assert(this.initialized, 'must be initialized');

    let found: SignedBlock|undefined;
    let blockPos = 0;
    while (blockPos < this.blockTailPos) {
      const block = await this.readBlock(blockPos);
      blockPos += block[1];
      if (block[0].height.eq(height)) {
        found = block[0];
        await fsTruncate(this.dbFile, blockPos);
        this.blockTailPos = blockPos;
        break;
      }
    }
    assert(found, 'unable to chop at designated block height');
    await this.index.setChainHeight(found!.height);
  }

  async close(): Promise<void> {
    this.initialized = false;
    if (this.dbFd !== undefined) {
      await fsClose(this.dbFd);
      this.dbFd = undefined;
    }
  }

  async write(block: SignedBlock): Promise<void> {
    if (!this._blockHead) {
      assert(block.height.eq(0), 'New db must start with genesis block');
    }

    const serBlock = Buffer.from(block.fullySerialize(true).toBuffer());
    const blockLen = serBlock.length;

    const val = Long.fromNumber(this.blockTailPos, true);
    await this.index.setBlockPos(block.height, val);
    await this.index.setChainHeight(block.height);

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

    this._blockHead = block;
    this.blockTailPos += blockLen + 16; // checksum + blockLen
    this.blockCache.push(block);
  }

  async read(blockHeight: Long): Promise<SignedBlock|undefined> {
    const block = this.blockCache.get(blockHeight);
    if (block) return block;

    const pos = await this.index.getBlockPos(blockHeight);
    if (!pos) return;

    return (await this.readBlock(pos.toNumber()))[0];
  }

  async readBlockLog(cb: (err: any,
                          block: SignedBlock,
                          bytePos: number,
                          byteLen: number) => void): Promise<void> {
    let blockPos = 0;
    while (blockPos < this.blockTailPos) {
      let block;
      try {
        block = await this.readBlock(blockPos);
      } catch (err) {
        cb(err, undefined!, undefined!, undefined!);
        break;
      }
      await cb(undefined, block[0], blockPos, block[1]);
      blockPos += block[1];
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

class BlockCache {

  static MAX_CACHE_SIZE = 1000;

  private readonly cache: {[key: string]: SignedBlock} = {};
  private min?: Long;
  private count = 0;

  get(height: Long): SignedBlock|undefined {
    if (!this.min) return;
    else if (!(height.lt(this.min) || height.gt(this.min.add(this.count)))) return;
    return this.cache[height.toString()];
  }

  push(block: SignedBlock): void {
    this.cache[block.height.toString()] = block;
    if (this.count + 1 > BlockCache.MAX_CACHE_SIZE) {
      delete this.cache[this.min!.toString()];
      this.min = this.min!.add(1);
    } else {
      if (!this.min) this.min = block.height;
      ++this.count;
    }
  }
}

function sha256(val: Buffer) {
  return crypto.createHash('sha256').update(val).digest();
}
