import * as path from 'path';

export namespace GODcoinEnv {
  export const GODCOIN_HOME = (() => {
    /* istanbul ignore next */
    if (process.env.GODCOIN_HOME) {
      return process.env.GODCOIN_HOME;
    } else if (process.platform === 'win32') {
      return path.join(process.env.APPDATA!, '.godcoin');
    }
    return path.join(process.env.HOME!, '.godcoin');
  })();
  export const GODCOIN_RC = process.env.GODCOIN_RC || path.join(GODCOIN_HOME, 'godcoinrc');
}
