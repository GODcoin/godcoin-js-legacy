import * as readline from 'readline';
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

export function hookSigInt(callback: () => void, rli?: readline.ReadLine) {
  let force = false;

  if (process.platform === 'win32') {
    var rl = rli ? rli : readline.createInterface({
      input: process.stdin
    });

    rl.on('SIGINT', () => {
      process.emit('SIGINT');
    });
  } else if (rli) {
    rli.on('SIGINT', () => {
      process.emit('SIGINT');
    });
  }

  process.on('SIGINT', () => {
    if (force) {
      console.log('Force quit');
      process.exit(1);
    }
    try {
      console.log('\nDouble press ctrl-c to force quit');
      callback();
    } finally {
      force = true;
      setTimeout(() => {
        force = false;
      }, 1000).unref();
    }
  });
}
