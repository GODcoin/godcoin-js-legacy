import * as path from 'path';

export function getAppDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDIR as string, 'godcoin');
  }
  return path.join(process.env.HOME as string, '.godcoin');
}
