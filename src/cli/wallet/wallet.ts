/* tslint:disable:max-line-length */

import * as assert from 'assert';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as readline from 'readline';
import {
  ClientNet,
  ClientPeer,
  ClientType,
  GODcoinEnv,
  hookSigInt
} from '../../lib';
import * as Command from './cmd';
import { WalletDb } from './db';
import { WalletState } from './wallet_state';
import { write } from './writer';

export class Wallet {

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

  static writeHelp(header: string, cmds: string[][]) {
    let maxLen = 0;
    for (const cmd of cmds) {
      assert(cmd.length === 2);
      const cmdLen = cmd[0].length;
      if (cmdLen > maxLen) maxLen = cmdLen;
    }

    write(header);
    for (const cmd of cmds) {
      let c = cmd[0];
      if (c.length < maxLen) c += ' '.repeat(maxLen - c.length);
      write('  ' + c + '  ' + cmd[1]);
    }
  }

  state = WalletState.NEW;
  client: ClientPeer;

  rl!: readline.ReadLine;
  db!: WalletDb;

  constructor(nodeUrl: string) {
    const net = new ClientNet(nodeUrl);
    net.clientType = ClientType.WALLET;
    this.client = new ClientPeer({
      blockchain: undefined!,
      pool: undefined!
    }, net);
  }

  async start() {
    const walletDir = path.join(GODcoinEnv.GODCOIN_HOME, 'wallet');
    mkdirp.sync(walletDir);
    await new Promise((resolve, reject) => {
      this.db = new WalletDb(walletDir, err => {
        if (err) return reject(err);
        resolve();
      });
    });

    await this.client.start();

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
        await this.client.stop();
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
      case 'new':
        return await Command.execNew(this, args);
      case 'unlock':
        return await Command.execUnlock(this, args);
      case 'get_properties':
        return await Command.execGetProperties(this, args);
      case 'get_block':
        return await Command.execGetBlock(this, args);
      case 'get_block_range':
        return await Command.execGetBlockRange(this, args);
      case 'get_total_fee':
        return await Command.execGetTotalFee(this, args);
      case 'get_balance':
        return await Command.execGetBalance(this, args);
      case 'create_account':
        return await Command.execCreateAccount(this, args);
      case 'remove_account':
        return await Command.execRemoveAccount(this, args);
      case 'import_account':
        return await Command.execImportAccount(this, args);
      case 'list_accounts':
        return await Command.execListAccounts(this, args);
      case 'list_all_keys':
        return await Command.execListAllKeys(this, args);
      case 'transfer':
        return await Command.execTransfer(this, args);
      case 'create_bond':
        return await Command.execCreateBond(this, args);
      default:
        write('Unknown command:', args[0]);
      case 'help':
        const cmds: string[][] = [];
        cmds.push(['help', 'display this help menu']);
        cmds.push(['new <password>', 'create a new wallet']);
        cmds.push(['unlock <password>', 'unlock the wallet']);
        cmds.push(['get_properties', 'retrieve network and blockchain properties']);
        cmds.push(['get_block <height>', 'retrieve a block at the specified height']);
        cmds.push(['get_block_range <min_height> <max_height>', 'retrieve a block range at the specified heights']);
        cmds.push(['get_total_fee <address|account>', 'retrieve the minimum address and network fee combined to broadcast transactions']);
        cmds.push(['get_balance <address|account>', 'retrieve the total balance of a public address or account']);
        cmds.push(['create_account <name>', 'create an account and a new key pair']);
        cmds.push(['remove_account <name>', 'remove an account']);
        cmds.push(['import_account <name> <private_key>', 'import an account with the following name and private key']);
        cmds.push(['list_accounts', 'list all accounts in the wallet']);
        cmds.push(['list_all_keys', 'list all keys in the wallet']);
        cmds.push(['transfer <from_account> <to_address> <amount> [memo]', 'transfer funds from an account to another GODcoin public address']);
        cmds.push(['create_bond <minter_account> <staker_account> <stake_amount>', 'create a bond to become a producer in the network']);
        Wallet.writeHelp('Available commands:', cmds);
    }
  }
}
