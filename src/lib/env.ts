import * as path from 'path';

let APP_DIR: string;
if (process.env.GODCOIN_DIR) {
  APP_DIR = process.env.GODCOIN_DIR;
} else if (process.platform === 'win32') {
  APP_DIR = path.join(process.env.APPDIR!, '.godcoin');
} else {
  APP_DIR = path.join(process.env.HOME!, '.godcoin');
}

export namespace GODcoinEnv {
  export const GODCOIN_TRUST_PROXY = process.env.GODCOIN_TRUST_PROXY === 'true';
  export const GODCOIN_HOME = APP_DIR;
  export const GODCOIN_RC = process.env.GODCOIN_RC || path.join(APP_DIR, 'godcoinrc');
}
