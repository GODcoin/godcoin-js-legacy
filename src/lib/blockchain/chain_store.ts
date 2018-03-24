import { ChainIndex, IndexProp } from './chain_index';
import { TypeSerializer as TS } from '../serializer';
import * as ByteBuffer from 'bytebuffer';
import { SignedBlock } from './block';
import * as crypto from 'crypto';
import * as mkdirp from 'mkdirp';
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

const LOCK_FILE = 'LOCK';

export class ChainStore {

  private _blockHeight!: Long;
  get blockHeight(): Long {
    return this._blockHeight;
  }

  readonly index: ChainIndex;
  readonly dir: string;
  readonly globalLock: string;
  readonly dbLock: string;
  readonly dbFile: string;

  constructor(dir: string, index: ChainIndex) {
    dir = path.join(dir, 'data');
    this.dir = dir;
    this.globalLock = path.join(dir, 'GLOBAL_LOCK');
    this.dbLock = path.join(dir, 'LOCK');
    this.dbFile = path.join(dir, 'blkdata');
    this.index = index;
  }

  async write(block: SignedBlock): Promise<void> {
    if (!this._blockHeight) {
      assert(block.height.eq(0), 'New db must start with genesis block');
      this._blockHeight = block.height;
    }
    const lockFd = await fsOpen(this.dbLock, 'wx');
    {
      const serBlock = block.fullySerialize(true);
      serBlock.mark().flip();
      let dataBuf = Buffer.from(serBlock.toBuffer());
      const checksum = sha256(dataBuf).slice(0, 8);
      serBlock.reset().append(checksum).flip();
      dataBuf = Buffer.from(serBlock.toBuffer());

      const blockPos = (await fsStat(this.dbFile)).size;
      const dbFd = await fsOpen(this.dbFile, 'a');
      const bufLen = new ByteBuffer(4, ByteBuffer.BIG_ENDIAN);
      bufLen.writeUint32(serBlock.limit).flip();
      await fsWrite(dbFd, Buffer.from(bufLen.toBuffer()));
      await fsWrite(dbFd, dataBuf);
      await fsClose(dbFd);

      const key = getBlockPosString(block.height);
      const val = Long.fromNumber(blockPos, true).toString();
      await this.index.setProp(key, val);
    }
    await fsClose(lockFd);
    await fsUnlink(this.dbLock);
  }

  async read(blockHeight: number|Long): Promise<SignedBlock|undefined> {
    let blockPos;
    try {
      blockPos = await this.index.getProp(getBlockPosString(blockHeight));
      blockPos = Long.fromString(blockPos, true);
    } catch (e) {
      if (e.notFound) {
        return;
      }
      throw e;
    }

    const dbFd = await fsOpen(this.dbFile, 'r');
    const buf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY,
                                ByteBuffer.BIG_ENDIAN);
    {
      // Read the length of the block
      let tmp = Buffer.allocUnsafe(4);
      let read = await fsRead(dbFd, tmp, blockPos, blockPos + 4, null);
      assert.equal(read.bytesRead, 4, 'unexpected EOF');
      buf.append(tmp);

      // Read the block
      const len = buf.readUint32();
      tmp = Buffer.allocUnsafe(len);
      read = await fsRead(dbFd, tmp, blockPos + 4, blockPos + len, null);
      assert.equal(read.bytesRead, len, 'unexpected EOF');

      // Verify the checksum of the stored block
      const checksum = tmp.slice(-8);
      tmp = tmp.slice(0, -8);
      assert(sha256(tmp).slice(0, 8).equals(checksum), 'invalid checksum');
      buf.clear().append(tmp).flip();
    }

    return SignedBlock.fullyDeserialize(buf);
  }

  async init(): Promise<void> {
    mkdirp.sync(this.dir);
    if (await fsExists(this.dbLock)) {
      throw new Error('DB lock file exists - possibly running more than 1 instance or abruptly shutdown');
    }

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
  }

  async lock(): Promise<void> {
    const exists = await fsExists(this.globalLock);
    assert(!exists, 'global lock file exists: possibly running more than 1 instance');
    await fsClose(await fsOpen(this.globalLock, 'wx'));
  }

  async unlock(): Promise<void> {
    await fsUnlink(this.globalLock);
  }
}

function getBlockPosString(blockNum: number|Long) {
  return 'block_pos_' + blockNum.toString();
}

function sha256(val: Buffer) {
  return crypto.createHash('sha256').update(val).digest();
}
