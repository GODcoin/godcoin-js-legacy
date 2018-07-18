import * as fs from 'fs';
import * as sodium from 'libsodium-wrappers';
import * as yargs from 'yargs';
import {
  generateKeyPair,
  GODcoinEnv,
  hookSigInt,
  Node,
  PrivateKey
} from '../lib';
import { Wallet } from './wallet';

function startNode(argv: any): void {
  const wif = argv['minter-wif'];
  const node = new Node({
    homeDir: GODcoinEnv.GODCOIN_HOME,
    signingKeys: wif ? PrivateKey.fromWif(wif) : undefined as any,
    reindex: argv.reindex,
    peers: argv.peers,
    listen: argv.listen,
    bind: argv.bind,
    port: argv.port
  });
  hookSigInt(() => {
    console.log('Shutting down node...');
    node.stop().catch(e => {
      console.log('Failed to stop node properly', e);
    });
  });

  node.start().catch(e => {
    console.log('Failed to start node', e);
  });
}

function startWallet(argv: any): void {
  const wallet = new Wallet(argv.server);
  wallet.start().catch(e => {
    console.log('Failed to initialize wallet\n', e);
  });
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

  try {
    fs.accessSync(GODcoinEnv.GODCOIN_HOME);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    fs.mkdirSync(GODcoinEnv.GODCOIN_HOME);
  }

  let conf: any = {};
  if (fs.existsSync(GODcoinEnv.GODCOIN_RC)) {
    conf = JSON.parse(fs.readFileSync(GODcoinEnv.GODCOIN_RC, 'utf8'));
  }
  const cmd: string|undefined = conf.$0;
  delete conf.$0;

  yargs.command(cmd === 'node' ? ['node', '$0'] : ['node'], 'Start the full node server', () => {
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
    }).option('peers', {
      array: true,
      default: [],
      requiresArg: false,
      desc: 'A list of peers to connect to and keep the connection open'
    }).option('minter-wif', {
      string: true,
      requiresArg: true,
      desc: 'Private WIF key for minting new blocks, required for minting'
    }).option('reindex', {
      boolean: true,
      default: false,
      desc: 'Reindexes the blockchain log'
    });
  }, startNode).command(cmd === 'wallet' ? ['wallet', '$0'] : ['wallet'], '', () => {
    return yargs.option('server', {
      string: true,
      default: 'ws://127.0.0.1:7777',
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
