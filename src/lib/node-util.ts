import * as readline from 'readline';

export function hookSigInt(callback: () => void) {
  if (process.platform === 'win32') {
    var rl = readline.createInterface({
      input: process.stdin
    });

    rl.on('SIGINT', () => {
      process.emit('SIGINT');
    });
  }

  process.on('SIGINT', callback);
}
