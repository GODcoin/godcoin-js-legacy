import { generateKeyPair, PrivateKey } from '../lib/crypto';
import { Daemon, getAppDir } from '../lib/daemon';
import * as sodium from 'libsodium-wrappers';
import * as nodeUtil from '../lib/node-util';
import * as yargs from 'yargs';
import * as path from 'path';
import * as fs from 'fs';

function startDaemon(argv: any): void {
  const wif = argv['minter-wif'];
  const daemon = new Daemon({
    signingKeys: wif ? PrivateKey.fromWif(wif) : undefined as any,
    regtest: argv.regtest,
    bind: argv.bind,
    listen: argv.listen,
    port: argv.port
  });
  nodeUtil.hookSigInt(() => {
    console.log();
    console.log('Shutting down daemon...');
    daemon.stop().catch(e => {
      console.log('Failed to stop daemon properly', e);
    });
  });

  daemon.start().catch(e => {
    console.log('Failed to start daemon', e);
  });
}

function startWallet(argv: any): void {

}

function keygen(argv: any): void {
  const keys = generateKeyPair();
  console.log('Your keys have been generated');
  console.log('Private key WIF: ' + keys.privateKey.toWif(argv.extended));
  console.log('Public key WIF: ' + keys.publicKey.toWif());
  console.log('- YOUR COINS CANNOT BE RECOVERED IF YOU LOSE YOUR PRIVATE KEY!');
  console.log('- NEVER GIVE YOUR PRIVATE KEY TO ANYONE!');
}

(async () => {
  await sodium.ready;

  const appDir = getAppDir();
  try {
    fs.accessSync(appDir);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    fs.mkdirSync(appDir);
  }

  const confPath = process.env.GODCOINRC || path.join(appDir, 'godcoinrc');
  let conf: any = {};
  if (fs.existsSync(confPath)) {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  }
  const cmd: string|undefined = conf.$0;
  delete conf.$0;

  yargs.command(cmd === 'daemon' ? ['daemon', '$0'] : ['daemon'], 'Start the full node server', () => {
    return yargs.option('listen', {
      boolean: true,
      default: true,
      desc: 'Whether to accept incoming peer-to-peer connections to this node or not'
    }).option('bind', {
      string: true,
      default: '0.0.0.0',
      requiresArg: true,
      desc: 'Bind address for peer-to-peer network connectivity'
    }).option('port', {
      number: true,
      default: 7777,
      requiresArg: true,
      desc: 'Port for peer-to-peer network connectivity'
    }).option('regtest', {
      boolean: true,
      default: false,
      desc: 'Runs the network in regtest mode allowing blocks to be minted instantly'
    }).option('minter-wif', {
      string: true,
      requiresArg: true,
      desc: 'Private WIF key for minting new blocks, required for minting'
    });
  }, startDaemon).command(cmd === 'wallet' ? ['wallet', '$0'] : ['wallet'], '', () => {
    return yargs.option('server', {
      string: true,
      default: '127.0.0.1:7777',
      requiresArg: true,
      desc: 'Node to connect to for interacting with the blockchain'
    });
  }, startWallet).command(cmd === 'keygen' ? ['keygen', '$0'] : ['keygen'], 'Standalone keypair generator', () => {
    return yargs.option('extended', {
      boolean: true,
      default: false,
      desc: 'Whether to generate an extended private key'
    });
  }, keygen).demandCommand(1, 'No command provided')
    .usage('godcoin <command>')
    .version(false)
    .config(conf)
    .strict()
    .parse();
})().catch(e => {
  console.error(e);
});
