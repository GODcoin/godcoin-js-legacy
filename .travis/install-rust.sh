#!/usr/bin/env bash
set -e

if [ ! -d "$HOME/.cargo/bin" ]; then
  wget https://sh.rustup.rs -O rustup-init.sh
  chmod +x rustup-init.sh
  ./rustup-init.sh -y --no-modify-path
else
  echo 'Using cached directory.'
  rustup update
fi

