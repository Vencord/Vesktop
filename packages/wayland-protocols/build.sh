#!/bin/sh
set -e

docker build -t vesktop-wayland-protocols-builder -f Dockerfile .

docker run --rm -v "$PWD":/src -w /src vesktop-wayland-protocols-builder bash -c "
  set -e

  echo '=== Building x64 ==='
  pnpm napi build --cross-compile --release --target=x86_64-unknown-linux-gnu
  mv wayland-protocols.node prebuilds/wayland-protocols-x64.node

  echo '=== Building arm64 ==='
  pnpm napi build --cross-compile --release --target=aarch64-unknown-linux-gnu
  mv wayland-protocols.node prebuilds/wayland-protocols-arm64.node
"
