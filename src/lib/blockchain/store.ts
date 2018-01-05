import { TypeSerializer as TS } from '../serializer';
import { getAppDir } from '../daemon/util';
import { doubleSha256 } from '../crypto';
import * as ByteBuffer from 'bytebuffer';
import { SignedBlock } from './block';
import * as assert from 'assert';
import * as level from 'level';
import * as path from 'path';
import * as util from 'util';
import * as long from 'long';
import * as fs from 'fs';

const fsOpen = util.promisify(fs.open);
const fsClose = util.promisify(fs.close);
const fsUnlink = util.promisify(fs.unlink);
const fsExists = util.promisify(fs.exists);
const fsWrite = util.promisify(fs.write);
const fsRead = util.promisify(fs.read);

const LOCK_FILE = 'LOCK';

class BlockIndex {
  readonly db: any;

  constructor(dbPath) {
    this.db = level(dbPath);
  }

  async get(blockNum: Long): Promise<Long|undefined> {
    try {
      const pos = this.db.get(blockNum.toString());
      return long.fromString(pos);
    } catch (e) {
      if (e.notFound) {
        return;
      }
      throw e;
    }
  }

  async set(blockNum: Long, bytePos: Long): Promise<void> {
    await this.db.set(blockNum.toString(), bytePos.toString());
  }
}

export class BlockStore {

  readonly index: BlockIndex;
  readonly dir: string;
  readonly lockFile: string;
  readonly dbFile: string;

  constructor(dir = getAppDir()) {
    this.dir = path.join(dir, 'data');
    this.lockFile = path.join(this.dir, 'LOCK');
    this.dbFile = path.join(this.dir, 'blkdata');
    this.index = new BlockIndex(path.join(this.dir, 'blkindex'));
    fs.mkdirSync(this.dir);
  }

  async checkLock(): Promise<void> {
    const exists = await fsExists(this.lockFile);
    if (exists) {
      throw new Error(`lock file exists`);
    }
  }

  async write(block: SignedBlock): Promise<void> {
    const lockFd = await fsOpen(this.lockFile, 'wx');
    {

      let dataByteBuf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY,
                                        ByteBuffer.BIG_ENDIAN);
      dataByteBuf.append(block.fullySerialize());
      dataByteBuf.writeUint32(block.transactions.length);
      block.transactions.forEach(tx => {
        dataByteBuf.append(tx.serialize());
        TS.array(TS.string)(dataByteBuf, tx.data.signatures);
      });
      dataByteBuf.mark().flip();
      let dataBuf = Buffer.from(dataByteBuf.toBuffer());
      const checksum = doubleSha256(dataBuf).slice(0, 8);
      dataByteBuf.reset().append(checksum).flip();
      dataBuf = Buffer.from(dataByteBuf.toBuffer());

      const dbFd = await fsOpen(this.dbFile, 'a');
      const bufLen = new ByteBuffer(4, ByteBuffer.BIG_ENDIAN);
      bufLen.writeUint32(dataByteBuf.limit).flip();
      await fsWrite(dbFd, Buffer.from(bufLen.toBuffer()));
      await fsWrite(dbFd, dataBuf);
      await fsClose(dbFd);
    }
    await fsClose(lockFd);
    await fsUnlink(this.lockFile);
  }

  async read(blockNum: Long): Promise<SignedBlock|undefined> {
    const bytePos = this.index.get(blockNum);
    if (!bytePos) {
      return;
    }

    const dbFd = await fsOpen(this.dbFile, 'a');
    const buf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY,
                                ByteBuffer.BIG_ENDIAN);
    {
      let tmp = Buffer.alloc(4);
      let read = await fsRead(dbFd, tmp, 0, 4, null);
      assert.equal(read.bytesRead, 4, 'unexpected EOF');
      buf.append(tmp);

      const len = buf.readUint32();
      tmp = Buffer.alloc(len);
      read = await fsRead(dbFd, tmp, 0, len, null);
      assert.equal(read.bytesRead, len, 'unexpected EOF');

      const checksum = tmp.slice(-8);
      tmp = tmp.slice(0, -8);
      assert(doubleSha256(tmp).slice(0, 8).equals(checksum), 'invalid checksum');
      buf.clear().append(tmp).flip();
    }

    // TODO: continue deserialization
  }
}
