#!/bin/sh
set -e

docker build -t libvesktop-builder -f Dockerfile .

docker run --rm -v "$PWD":/src -w /src libvesktop-builder bash -c "
  set -e

  curl -o /tmp/ext-idle-notify-v1.xml "https://gitlab.freedesktop.org/wayland/wayland-protocols/-/raw/20bcf732a9a173ae7d437882159fb7ababb4713e/staging/ext-idle-notify/ext-idle-notify-v1.xml"

  wayland-scanner client-header \
    /tmp/ext-idle-notify-v1.xml \
    src/ext-idle-notify-v1-client-protocol.h

  wayland-scanner private-code \
    /tmp/ext-idle-notify-v1.xml \
    src/ext-idle-notify-v1-protocol.c

  echo '=== Building x64 ==='
  npx node-gyp rebuild --arch=x64
  mv build/Release/vesktop.node prebuilds/vesktop-x64.node

  echo '=== Building arm64 ==='
  export CXX=aarch64-linux-gnu-g++
  export CC=aarch64-linux-gnu-gcc
  npx node-gyp rebuild --arch=arm64
  mv build/Release/vesktop.node prebuilds/vesktop-arm64.node

  rm src/ext-idle-notify-v1-client-protocol.h
  rm src/ext-idle-notify-v1-protocol.c
"
