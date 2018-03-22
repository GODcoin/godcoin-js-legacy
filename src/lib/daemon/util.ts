import * as path from 'path';

let APP_DIR: string|undefined;

export function getAppDir(): string {
  if (APP_DIR) return APP_DIR;
  let dir: string;
  if (process.env.GODCOIN_DIR) {
    dir = process.env.GODCOIN_DIR;
  } else if (process.platform === 'win32') {
    dir = process.env.APPDIR!;
  } else {
    dir = process.env.HOME!;
  }
  return APP_DIR = path.join(dir, '.godcoin');
}
