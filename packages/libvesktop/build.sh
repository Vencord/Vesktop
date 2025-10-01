#!/bin/sh
set -e

docker build -t libvesktop-builder -f Dockerfile.build .

docker run --rm -v "$PWD":/src -w /src libvesktop-builder bash -c "
  set -e

  npm install

  echo '=== Building x64 ==='
  npx node-gyp rebuild --arch=x64
  mv build/Release/vesktop.node vesktop-x64.node

  echo '=== Building arm64 ==='
  export CXX=aarch64-linux-gnu-g++
  npx node-gyp rebuild --arch=arm64
  mv build/Release/vesktop.node vesktop-arm64.node
"