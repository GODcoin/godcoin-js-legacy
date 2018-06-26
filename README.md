# GODcoin
[![Build Status](https://travis-ci.org/GODcoin/GODcoin-js.svg?branch=master)](https://travis-ci.org/GODcoin/GODcoin-js)

https://godcoin.gold

## What is GODcoin?

GODcoin is the official currency of Christ. There are two types of digital
tokens, gold and silver, which can be exchanged for physical gold and silver.
GODcoin uses proof-of-Stake consensus in a peer-to-peer network for energy
efficiency and security of assets.

For more information see the [whitepaper](https://godcoin.gold/whitepaper).

## Development

At the current stage, this software is considered experimental and under heavy
development. Many components are changing on a daily basis so documentation
will be minimal until the software stabilizes.

### Prerequisites

- NodeJS 10+
- Yarn

This project does not, and will never, use npm. Yarn is able to keep the lock
file consistently generated and lock all dependencies down to the lock file.

### Getting started

Make sure the source code is locally available by either cloning the repository
or downloading it.

Install the dependencies:
```
$ yarn install
```

Run the test suite:
```
$ yarn run test
```

Launch GODcoin:
```
$ node ./bin/godcoin.js
```
