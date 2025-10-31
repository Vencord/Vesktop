#!/bin/sh

set -e

echo "building x86_64"
pnpm napi build --use-napi-cross --release --target=x86_64-unknown-linux-gnu
mv wayland-protocols.node prebuilds/wayland-protocols-x64.node

echo "building aarch64/arm64"
pnpm napi build --use-napi-cross --release --target=aarch64-unknown-linux-gnu
mv wayland-protocols.node prebuilds/wayland-protocols-arm64.node
