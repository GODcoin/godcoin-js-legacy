import * as readline from 'readline';

export function hookSigInt(callback: () => void) {
  let force = false;

  if (process.platform === 'win32') {
    var rl = readline.createInterface({
      input: process.stdin
    });

    rl.on('SIGINT', () => {
      process.emit('SIGINT');
    });
  }

  process.on('SIGINT', () => {
    if (force) {
      process.exit(1);
    }
    try {
      console.log('Double press ctrl-c to force quit');
      callback();
    } finally {
      force = true;
      setTimeout(() => {
        force = false;
      }, 1000).unref();
    }
  });
}
