import { getAppDir, hookSigInt } from '../lib';
import * as sodium from 'libsodium-wrappers';
import * as readline from 'readline';
import * as mkdirp from 'mkdirp';
import * as crypto from 'crypto';
import * as assert from 'assert';
import * as level from 'level';
import * as path from 'path';
import * as fs from 'fs';

export class Wallet {

  private rl!: readline.ReadLine;
  private db!: WalletDb;

  private state = WalletState.NEW;

  async start() {
    const walletDir = path.join(getAppDir(), 'wallet');
    mkdirp.sync(walletDir);
    await new Promise((resolve, reject) => {
      this.db = new WalletDb(walletDir, err => {
        if (err) return reject(err);
        resolve();
      });
    });

    let prompt = 'new>> ';
    if (await this.db.isLocked()) {
      prompt = 'locked>> ';
      this.state = WalletState.LOCKED;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      removeHistoryDuplicates: true,
      prompt
    } as any);

    this.rl.prompt();
    this.rl.on('line', async input => {
      try {
        await this.processLine(input);
      } catch (e) {
        write(e);
      } finally {
        this.rl.prompt();
      }
    });

    hookSigInt(async () => {
      write('Exiting wallet...');
      try {
        await this.db.close();
      } catch (e) {
        write('Failed to close wallet db', e);
      }
      this.rl.close();
    }, this.rl);
  }

  private async processLine(input: string): Promise<void> {
    const args = Wallet.parse(input);
    if (!args.length) return;

    switch (args[0]) {
      case 'new': {
        if (this.state === WalletState.UNLOCKED) {
          write('Wallet already unlocked');
          break;
        } else if (this.state === WalletState.LOCKED) {
          write('Wallet already exists, use `unlock <password>`');
          break;
        } else if (this.state !== WalletState.NEW) {
          write('Unknown wallet state:', this.state);
          break;
        }

        const pw = (args[1] || '').trim();
        if (!pw) {
          write('new <password> - missing password');
          break;
        }
        this.db.setPassword(pw);
        await this.db.setProp(WalletIndexProp.INITIALIZED, 'hello');
        const msg = await this.db.getProp(WalletIndexProp.INITIALIZED);
        assert.equal(msg, 'hello', 'failed to decrypt during encryption test');

        this.state = WalletState.LOCKED;
        this.db.lock();
        this.rl.setPrompt('locked>> ');
        break;
      }
      case 'unlock': {
        if (this.state === WalletState.NEW) {
          write('Wallet is not initialized, create a new wallet with `new <password>`');
          break;
        } else if (this.state === WalletState.UNLOCKED) {
          write('Wallet is already unlocked');
          break;
        }
        const pw = (args[1] || '').trim();
        if (!pw) {
          write('unlock <password> - missing password');
          break;
        }

        this.db.setPassword(pw);
        try {
          const msg = await this.db.getProp(WalletIndexProp.INITIALIZED);
          if (msg !== 'hello') {
            write('Failed to unlock wallet, incorrect password');
            break;
          }
          this.state = WalletState.UNLOCKED;
          this.rl.setPrompt('unlocked>> ');
        } catch (e) {
          if (e.message === 'wrong secret key for the given ciphertext') {
            write('Failed to unlock wallet, incorrect password');
            this.db.lock();
            break;
          }
          throw e;
        }
        break;
      }
      default:
        write('Unknown command:', args[0]);
      case 'help':
        write('Available commands:');
        write('  help               - Displays this help menu');
        write('  new <password>     - creates a new wallet');
        write('  unlock <password>  - unlocks your wallet');
    }
  }

  static parse(line: string): string[] {
    line = line.trim();
    const args: string[] = [];
    let tmp = '';
    let inQuotes = false;

    loop: for (let i = 0; i < line.length; ++i) {
      switch (line[i]) {
        case ' ':
          if (!inQuotes) {
            args.push(tmp);
            tmp = '';
          } else {
            tmp += ' ';
          }
          break;
        case '"':
          const prev = line[i - 1];
          if (prev === '\\') {
            tmp += line[i];
            continue loop;
          }
          if (!inQuotes) {
            if (prev !== ' ') throw new Error(`Unexpected " character at pos ${i}`);
            inQuotes = true;
          } else {
            const cont = (++i < line.length) ? line[i] : undefined;
            if (cont !== undefined && cont !== ' ') {
              throw new Error(`Unexpected " character at pos ${i}`);
            }
            args.push(tmp);
            tmp = '';
            inQuotes = false;
          }
          break;
        case '\\':
          continue loop;
        default:
          tmp += line[i];
      }
    }
    if (tmp.length) {
      if (inQuotes) throw new Error('Expected closing " character');
      args.push(tmp);
      tmp = '';
    }
    return args;
  }
}

class WalletDb {

  private readonly db: any;
  private password!: Buffer;

  constructor(dbPath: string, cb: (err?: any) => void) {
    this.db = level(dbPath, function (err, db) {
      /* istanbul ignore next */
      if (err) return cb(err);
      cb();
    });
  }

  setPassword(pw: string) {
    assert(!this.password, 'password is already set');
    this.password = crypto.createHash('sha256').update(pw).digest();
  }

  lock() {
    this.password = undefined as any;
  }

  async isLocked(): Promise<boolean> {
    try {
      await this.db.get(WalletIndexProp.INITIALIZED);
      return true;
    } catch (e) {
      if (!e.notFound) throw e;
      return false;
    }
  }

  async getProp(prop: WalletIndexProp): Promise<any> {
    const value = await this.db.get(prop);
    assert(this.password, 'wallet not unlocked');
    const cipherText = Buffer.from(value, 'base64');
    const nonce = cipherText.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const enc = cipherText.slice(sodium.crypto_secretbox_NONCEBYTES);
    const dec = sodium.crypto_secretbox_open_easy(enc, nonce, this.password);
    return Buffer.from(dec).toString();
  }

  async setProp(prop: WalletIndexProp, value: string): Promise<void> {
    assert(this.password, 'wallet not unlocked');
    const msg = Buffer.from(value);
    const nonce = crypto.randomBytes(sodium.crypto_secretbox_NONCEBYTES);
    const enc = sodium.crypto_secretbox_easy(msg, nonce, this.password);
    const final = Buffer.concat([nonce, enc]);
    await this.db.put(prop, final.toString('base64'));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

enum WalletState {
  NEW,
  LOCKED,
  UNLOCKED
}

enum WalletIndexProp {
  INITIALIZED = 'INITIALIZED'
}

function write(...data: any[]) {
  console.log(...data);
}
