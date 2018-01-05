import { generateKeyPair } from '../lib/crypto';
import * as sodium from 'libsodium-wrappers';
import { Daemon } from '../lib/daemon';
import * as yargs from 'yargs';

function startDaemon(argv: any): void {
  if (argv.listen) {
    console.log(`starting up the daemon on ${argv.bind}:${argv.port}`);
  }
  const genesisKeys = generateKeyPair();
  console.log('Genesis minter private WIF: ' + genesisKeys.privateKey.toWif());
  console.log('Genesis minter public WIF: ' + genesisKeys.publicKey.toWif());

  const daemon = new Daemon({
    signingKeys: genesisKeys,
    regtest: false
  });
  daemon.start();
}

function startWallet(argv: any): void {

}

(async () => {
  await sodium.ready;

  yargs.command(['daemon', '$0'], 'Start the full node server', () => {
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
    });
  }, startDaemon).command(['wallet'], '', () => {
    return yargs.option('server', {
      string: true,
      default: '127.0.0.1:7777',
      requiresArg: true,
      desc: 'Node to connect to for interacting with the blockchain'
    });
  }, startWallet).demandCommand(1, 'No command provided')
    .usage('godcoin <command>')
    .version(false)
    .strict()
    .parse();
})().catch(e => {
  console.error(e);
});
