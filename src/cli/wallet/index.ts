import { getAppDir, hookSigInt, SignedBlock } from '../../lib';
import { WalletDb, WalletIndexProp } from './db';
import * as ByteBuffer from 'bytebuffer';
import * as readline from 'readline';
import { WalletNet } from './net';
import * as mkdirp from 'mkdirp';
import * as assert from 'assert';
import * as WebSocket from 'ws';
import * as path from 'path';

export class Wallet {

  private state = WalletState.NEW;
  private net: WalletNet;

  private rl!: readline.ReadLine;
  private db!: WalletDb;

  constructor(nodeUrl: string) {
    this.net = new WalletNet(nodeUrl);
  }

  async start() {
    const walletDir = path.join(getAppDir(), 'wallet');
    mkdirp.sync(walletDir);
    await new Promise((resolve, reject) => {
      this.db = new WalletDb(walletDir, err => {
        if (err) return reject(err);
        resolve();
      });
    });

    await this.net.open();

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
        this.net.close();
      } catch (e) {
        write('Failed to close websocket connection', e);
      }
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
      case 'get_block': {
        const height = Number((args[1] || '').trim());
        if (height === NaN) {
          write('get_block <height> - missing or invalid number for height');
          break;
        }

        const data = await this.net.send({
          method: 'get_block',
          height
        });
        if (data.block) {
          const buf = ByteBuffer.wrap(data.block.buffer);
          const block = SignedBlock.fullyDeserialize(buf);
          write(block.toString());
        } else {
          write('Invalid block height');
        }
        break;
      }
      case 'get_balance': {
        const address = (args[1] || '').trim();
        if (!address) {
          write('get_balance <address> - missing address');
          break;
        }

        const data = await this.net.send({
          method: 'get_balance',
          address
        });
        write([data.balance.gold, data.balance.silver]);
        break;
      }
      default:
        write('Unknown command:', args[0]);
      case 'help':
        write('Available commands:');
        write('  help                - Displays this help menu');
        write('  new <password>      - creates a new wallet');
        write('  unlock <password>   - unlocks your wallet');
        write('  get_block <height>  - retrieves a block at the specified height');
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

enum WalletState {
  NEW,
  LOCKED,
  UNLOCKED
}

function write(...data: any[]) {
  console.log(...data);
}
