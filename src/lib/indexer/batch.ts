import { Asset } from 'godcoin-neon';
import * as Codec from 'level-codec';
import * as Long from 'long';
import { Indexer, IndexProp } from './index';

const jsonCodec = new Codec({
  keyEncoding: 'binary',
  valueEncoding: 'json'
});

export interface AssetMap {
  [acc: string]: [Asset, Asset];
}

export class BatchIndex {

  private ops: any[] = [];
  private map?: AssetMap;

  constructor(private readonly indexer: Indexer) {
  }

  async setBlockPos(height: number, bytePos: Long): Promise<void> {
    const posBuf = Buffer.allocUnsafe(8);
    posBuf.writeInt32BE(bytePos.high, 0, true);
    posBuf.writeInt32BE(bytePos.low, 4, true);

    const blkHeightBuf = Buffer.allocUnsafe(8);
    const l = Long.fromNumber(height, true);
    blkHeightBuf.writeInt32BE(l.high, 0, true);
    blkHeightBuf.writeInt32BE(l.low, 4, true);

    this.ops.push({
      type: 'put',
      key: Buffer.concat([IndexProp.NAMESPACE_BLOCK, blkHeightBuf]),
      value: posBuf
    });
    await this.maybeFlush();
  }

  async setBalances(map: AssetMap): Promise<void> {
    this.map = map;
    await this.maybeFlush();
  }

  async flush(): Promise<void> {
    if (this.ops.length) {
      await new Promise<void>((res, rej) => {
        this.indexer.db.db.batch(this.ops, err => {
          if (err) return rej(err);
          res();
        });
      });
      this.ops.length = 0;
    }
    await this.flushBalances();
  }

  private async maybeFlush() {
    if (this.ops.length >= 10000) await this.flush();
  }

  private async flushBalances(): Promise<void> {
    if (!this.map) return;

    const batch = this.indexer.db.db.batch();
    batch.codec = jsonCodec; // Workaround for encoding-down
    for (const [hex, assets] of Object.entries(this.map)) {
      const key = [IndexProp.NAMESPACE_BAL, Buffer.from(hex, 'hex')];
      batch.put(Buffer.concat(key), [
        assets[0].toString(),
        assets[1].toString()
      ]);
    }
    return new Promise<void>((res, rej) => {
      batch.write(err => {
        if (err) return rej(err);
        this.map = undefined;
        res();
      });
    });
  }
}
