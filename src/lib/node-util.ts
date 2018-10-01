import * as readline from 'readline';

export function hookSigInt(callback: () => void, rli?: readline.ReadLine) {
  let force = false;

  if (process.platform === 'win32') {
    const rl = rli ? rli : readline.createInterface({
      input: process.stdin
    });

    rl.on('SIGINT', () => {
      process.emit('SIGINT', 'SIGINT');
    });
  } else if (rli) {
    rli.on('SIGINT', () => {
      process.emit('SIGINT', 'SIGINT');
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

export interface PromiseLike {
  resolve: (value?: any) => void;
  reject: (err?: any) => void;
}
