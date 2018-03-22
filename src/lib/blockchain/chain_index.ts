import * as level from 'level';

export enum IndexProp {
  CURRENT_BLOCK_HEIGHT = 'CURRENT_BLOCK_HEIGHT'
}

export class ChainIndex {
  readonly db: any;

  constructor(dbPath) {
    this.db = level(dbPath);
  }

  getProp(prop: string): Promise<any> {
    return this.db.get(prop);
  }

  async setProp(prop: string, value: any): Promise<void> {
    await this.db.put(prop, value);
  }

}
