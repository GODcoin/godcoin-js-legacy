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

  private _blockHeight!: Long;
  get blockHeight(): Long {
    return this._blockHeight;
  }

  private lock = new Lock();
  private initialized = false;

  readonly index: Indexer;
  readonly dbFile: string;

  constructor(dbFile: string, index: Indexer) {
    this.dbFile = dbFile;
    this.index = index;
  }

  async write(block: SignedBlock): Promise<void> {
    await this.lock.lock();
    try {
      if (!this._blockHeight) {
        assert(block.height.eq(0), 'New db must start with genesis block');
        this._blockHeight = block.height;
      }

      const serBlock = block.fullySerialize(true).reset();
      const checksum = sha256(Buffer.from(serBlock.toBuffer())).slice(0, 8);
      serBlock.offset = serBlock.limit;
      serBlock.append(checksum).flip();

      const blockPos = (await fsStat(this.dbFile)).size;
      const dbFd = await fsOpen(this.dbFile, 'a');
      {
        // Write the block length
        const bufLen = Buffer.allocUnsafe(4);
        bufLen.writeUInt32BE(serBlock.limit, 0);
        await fsWrite(dbFd, bufLen);
      }

      await fsWrite(dbFd, Buffer.from(serBlock.toBuffer()));
      await fsClose(dbFd);

      const key = getBlockPosString(block.height);
      const val = Long.fromNumber(blockPos, true).toString();
      await this.index.setProp(key, val);
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
      if (e.notFound) {
        return;
      }
      throw e;
    }

    const dbFd = await fsOpen(this.dbFile, 'r');
    try {
      // Read the length of the block
      let len: number;
      {
        const tmp = Buffer.allocUnsafe(4);
        const read = await fsRead(dbFd, tmp, blockPos, blockPos + 4, null);
        assert.equal(read.bytesRead, 4, 'unexpected EOF');
        len = tmp.readUInt32BE(0);
      }

      // Read the block
      let buf = Buffer.allocUnsafe(len);
      const read = await fsRead(dbFd, buf, 0, len, null);
      assert.equal(read.bytesRead, len, 'unexpected EOF');

      // Verify the checksum of the stored block
      const checksum = buf.slice(-8);
      buf = buf.slice(0, -8);
      assert(sha256(buf).slice(0, 8).equals(checksum), 'invalid checksum');

      // Deserialize and return
      const block = SignedBlock.fullyDeserialize(ByteBuffer.wrap(buf));
      assert(block.height.eq(blockHeight));
      return block;
    } catch (e) {
      throw e;
    } finally {
      await fsClose(dbFd);
    }
  }

  async init(): Promise<void> {
    assert(!this.initialized, 'already initialized');
    try {
      const height = await this.index.getProp(IndexProp.CURRENT_BLOCK_HEIGHT);
      this._blockHeight = Long.fromString(height, true);
    } catch (e) {
      if (!e.notFound) {
        throw e;
      }
    }
    if (!(await fsExists(this.dbFile))) {
      fs.closeSync(fs.openSync(this.dbFile, 'w'));
    }
    this.initialized = true;
  }
}

function getBlockPosString(blockNum: number|Long) {
  return 'block_pos_' + blockNum.toString();
}

function sha256(val: Buffer) {
  return crypto.createHash('sha256').update(val).digest();
}
