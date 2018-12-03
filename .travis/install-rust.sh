#!/usr/bin/env bash
set -e

if [ ! -f "$HOME/.cargo/bin/rustup" ]; then
  wget https://sh.rustup.rs -O rustup-init.sh
  chmod +x rustup-init.sh
  ./rustup-init.sh -y --no-modify-path --default-toolchain beta
else
  echo 'Using cached directory.'
  rustup update
  rustup default beta
fi
