import * as assert from 'assert';
import * as ByteBuffer from 'bytebuffer';
import * as fs from 'fs';
import * as Long from 'long';
import * as crc32 from 'sse4_crc32';
import * as util from 'util';
import { Indexer } from '../indexer';
import { SignedBlock } from './block';

const fsOpen = util.promisify(fs.open);
const fsClose = util.promisify(fs.close);
const fsWrite = util.promisify(fs.write);
const fsRead = util.promisify(fs.read);
const fsStat = util.promisify(fs.stat);
const fsTruncate = util.promisify(fs.truncate);

export class ChainStore {

  readonly index: Indexer;
  readonly dbFile: string;

  get blockHead(): SignedBlock {
    return this._blockHead;
  }

  private blockTailPos = 0;
  private _blockHead!: SignedBlock;

  private initialized = false;
  private dbFd?: number;

  private readonly blockCache = new BlockCache();

  constructor(dbFile: string, index: Indexer) {
    this.dbFile = dbFile;
    this.index = index;
  }

  async init(): Promise<void> {
    assert(!this.initialized, 'already initialized');
    this.dbFd = await fsOpen(this.dbFile, 'a+');
    this.blockTailPos = (await fsStat(this.dbFile)).size;
    this.initialized = true;
  }

  async postInit(): Promise<void> {
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
  }

  async close(): Promise<void> {
    this.initialized = false;
    if (this.dbFd !== undefined) {
      await fsClose(this.dbFd);
      this.dbFd = undefined;
    }
  }

  async write(block: SignedBlock): Promise<Long> {
    if (!this._blockHead) {
      assert(block.height.eq(0), 'New db must start with genesis block');
    }

    const serBlock = Buffer.from(block.fullySerialize(true).toBuffer());
    const blockLen = serBlock.length;

    const bytePos = Long.fromNumber(this.blockTailPos, true);
    const tmp = Buffer.allocUnsafe(4);
    {
      // Write the block length
      tmp.writeUInt32BE(blockLen, 0, true);
      await fsWrite(this.dbFd!, tmp, 0, 4);
    }
    await fsWrite(this.dbFd!, serBlock);

    const checksum = crc32.calculate(serBlock);
    tmp.writeUInt32BE(checksum, 0, true);
    await fsWrite(this.dbFd!, tmp, 0, 4);

    this._blockHead = block;
    this.blockTailPos += blockLen + 8; // blockLen + len num + checksum
    this.blockCache.push(block);

    return bytePos;
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
        await cb(err, undefined!, undefined!, undefined!);
        break;
      }
      await cb(undefined, block[0], blockPos, block[1]);
      blockPos += block[1];
    }
  }

  private async readBlock(blockPos: number): Promise<[SignedBlock, number]> {
    const tmp = Buffer.allocUnsafe(4);

    // Read the length of the block
    let read = await fsRead(this.dbFd!, tmp, 0, 4, blockPos);
    assert.equal(read.bytesRead, 4, 'unexpected EOF');
    const len = tmp.readUInt32BE(0, true);

    // Read the block
    const buf = Buffer.allocUnsafe(len);
    read = await fsRead(this.dbFd!, buf, 0, len, blockPos + 4);
    assert.equal(read.bytesRead, len, 'unexpected EOF');

    // Verify the checksum of the stored block
    {
      read = await fsRead(this.dbFd!, tmp, 0, 4, blockPos + len + 4);
      assert.equal(read.bytesRead, 4, 'unexpected EOF');
      const checksum = tmp.readUInt32BE(0, true);
      assert.equal(crc32.calculate(buf), checksum, 'invalid checksum');
    }

    // Deserialize and return
    const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(buf));
    return [block, len + 8];
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
