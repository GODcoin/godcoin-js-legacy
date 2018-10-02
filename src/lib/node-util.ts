import * as readline from 'readline';

export function hookSigInt(callback: () => void, rli?: readline.ReadLine) {
  if (!rli) {
    rli = readline.createInterface({
      input: process.stdin
    });
  }
  rli.on('SIGINT', () => {
    process.emit('SIGINT', 'SIGINT');
  });

  process.on('SIGINT', () => {
    try {
      rli!.close();
      callback();
    } finally {
      setTimeout(() => {
        process.exit(0);
      }, 1000).unref();
    }
  });
}

export interface PromiseLike {
  resolve: (value?: any) => void;
  reject: (err?: any) => void;
}
