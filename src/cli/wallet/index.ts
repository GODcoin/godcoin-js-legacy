import {
  generateKeyPair,
  AssetSymbol,
  hookSigInt,
  ClientType,
  GODcoinEnv,
  TransferTx,
  ClientPeer,
  PrivateKey,
  PublicKey,
  ClientNet,
  TxType,
  Asset
} from '../../lib';
import { WalletDb, WalletIndexProp } from './db';
import * as readline from 'readline';
import * as mkdirp from 'mkdirp';
import * as assert from 'assert';
import * as path from 'path';

export class Wallet {

  private state = WalletState.NEW;
  private client: ClientPeer;

  private rl!: readline.ReadLine;
  private db!: WalletDb;

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
      case 'new': {
        (this.rl as any).history.shift();
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
        (this.rl as any).history.shift();
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
      case 'get_properties': {
        const data = await this.client.getProperties();
        write(data);
        break;
      }
      case 'get_block': {
        const height = Number((args[1] || '').trim());
        if (height === NaN) {
          write('get_block <height> - missing or invalid number for height');
          break;
        }

        const block = await this.client.getBlock(height);
        if (block) write(block.toString());
        else write('Invalid block height');
        break;
      }
      case 'get_block_range': {
        const minHeight = Number((args[1] || '').trim());
        const maxHeight = Number((args[2] || '').trim());
        if (minHeight === NaN || maxHeight === NaN) {
          write('get_block_range <min_height> <max_height> - missing or invalid number for min and max heights');
          break;
        }

        const data = await this.client.getBlockRange(minHeight, maxHeight);
        const blocks: string[] = [];
        for (const block of data.blocks) {
          blocks.push(JSON.parse(block.toString()));
        }
        write(JSON.stringify({
          range_outside_height: data.range_outside_height,
          blocks
        }, undefined, 2));
        break;
      }
      case 'get_total_fee': {
        let address = (args[1] || '').trim();
        if (!address) {
          write('get_total_fee <address|account> - missing address or account');
          break;
        } else if (await this.db.hasAccount(address)) {
          const acc = await this.db.getAccount(address);
          address = acc.publicKey.toWif();
        }

        // Make sure the user can't accidentally input a private key
        const addr = PublicKey.fromWif(address);
        const fee = await this.getTotalFee(addr);
        write([
          fee[0].toString(),
          fee[1].toString()
        ]);
        break;
      }
      case 'get_balance': {
        let address = (args[1] || '').trim();
        if (!address) {
          write('get_balance <address|account> - missing address or account');
          break;
        } else if (await this.db.hasAccount(address)) {
          const acc = await this.db.getAccount(address);
          address = acc.publicKey.toWif();
        }

        // Make sure the user can't accidentally input a private key
        PublicKey.fromWif(address);

        const balance = await this.client.getBalance(address);
        write(balance);
        break;
      }
      case 'create_account': {
        const name = (args[1] || '').trim();
        if (!name) {
          write('create_account <name> - missing name');
          break;
        } else if (await this.db.hasAccount(name)) {
          write('Account already exists');
          break;
        }
        const keypair = generateKeyPair();
        await this.db.setAccount(name, keypair.privateKey);
        write({
          private_key: keypair.privateKey.toWif(),
          public_key: keypair.publicKey.toWif()
        });
        break;
      }
      case 'import_account': {
        const name = (args[1] || '').trim();
        const pk = (args[2] || '').trim();
        if (!(name && pk)) {
          write('import_account <name> <private_key> - missing name or private key');
          break;
        } else if (await this.db.hasAccount(name)) {
          write('Account already exists');
          break;
        }

        const priv = PrivateKey.fromWif(pk);
        await this.db.setAccount(name, priv.privateKey);
        break;
      }
      case 'list_accounts': {
        const accs = await this.db.getAllAccounts();
        write(accs.reduce((prev, val) => {
          prev[val[0]] = val[1].publicKey.toWif();
          return prev;
        }, {}));
        break;
      }
      case 'list_all_keys': {
        const accs = await this.db.getAllAccounts();
        write(accs.reduce((prev, val) => {
          prev[val[0]] = {
            privateKey: val[1].privateKey.toWif(),
            publicKey: val[1].publicKey.toWif()
          };
          return prev;
        }, {}));
        break;
      }
      case 'transfer': {
        const accountStr = (args[1] || '').trim();
        const toAddrStr = (args[2] || '').trim();
        const amtStr = (args[3] || '').trim();
        const memo = (args[4] || '').trim();
        if (!(accountStr && toAddrStr && amtStr)) {
          write('transfer <from_account> <to_address> <amount> [memo] - missing from_account, to_address, or amount');
          break;
        }
        const acc = await this.db.getAccount(accountStr);
        if (!acc) {
          write('Account not found');
          break;
        }

        const toAddr = PublicKey.fromWif(toAddrStr);
        const amt = Asset.fromString(amtStr);
        const totalFee = await this.getTotalFee(acc.publicKey);

        let fee: Asset;
        if (amt.symbol === AssetSymbol.GOLD) fee = totalFee[0];
        else if (amt.symbol === AssetSymbol.SILVER) fee = totalFee[1];
        assert(fee!, 'unhandled asset type: ' + amt.symbol);

        const tx = new TransferTx({
          type: TxType.TRANSFER,
          timestamp: new Date(),
          from: acc.publicKey,
          to: toAddr,
          amount: amt,
          fee: fee!,
          memo: Buffer.from(memo),
          signature_pairs: []
        }).appendSign(acc.privateKey);
        write('Broadcasting tx\n', tx.toString(), '\n');
        const buf = Buffer.from(tx.serialize(true).toBuffer());
        const data = await this.client.broadcast(buf);
        write(data);
        break;
      }
      default:
        write('Unknown command:', args[0]);
      case 'help':
        let cmds: string[][] = [];
        cmds.push(['help', 'display this help menu']);
        cmds.push(['new <password>', 'create a new wallet']);
        cmds.push(['unlock <password>', 'unlock the wallet']);
        cmds.push(['get_properties', 'retrieve network and blockchain properties']);
        cmds.push(['get_block <height>', 'retrieve a block at the specified height']);
        cmds.push(['get_block_range <min_height> <max_height>', 'retrieve a block range at the specified heights']);
        cmds.push(['get_total_fee <address|account>', 'retrieve the minimum address and network fee combined to broadcast transactions']);
        cmds.push(['get_balance <address|account>', 'retrieve the total balance of a public address or account']);
        cmds.push(['create_account <name>', 'create an account and a new key pair']);
        cmds.push(['import_account <name> <private_key>', 'import an account with the following name and private key']);
        cmds.push(['list_accounts', 'list all accounts in the wallet']);
        cmds.push(['list_all_keys', 'list all keys in the wallet']);
        cmds.push(['transfer <from_account> <to_address> <amount> [memo]', 'transfer funds from an account to another GODcoin public address']);
        Wallet.writeHelp('Available commands:', cmds);
    }
  }

  private async getTotalFee(addr: PublicKey): Promise<[Asset,Asset]> {
    const fee = await this.client.getTotalFee(addr.toWif());
    return [
      Asset.fromString(fee[0]),
      Asset.fromString(fee[1])
    ];
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
}

enum WalletState {
  NEW,
  LOCKED,
  UNLOCKED
}

function write(...data: any[]) {
  console.log(...data);
}
