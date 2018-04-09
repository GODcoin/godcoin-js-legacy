import * as level from 'level';

export enum IndexProp {
  CURRENT_BLOCK_HEIGHT = 'CURRENT_BLOCK_HEIGHT'
}

export class Indexer {
  private readonly db: any;

  constructor(dbPath) {
    this.db = level(dbPath, function (err, db) {
      if (err) throw err;
    });
  }

  getProp(prop: IndexProp|string): Promise<any> {
    return this.db.get(prop);
  }

  async setProp(prop: IndexProp|string, value: any): Promise<void> {
    await this.db.put(prop, value);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  batch() {
    return this.db.batch();
  }
}
