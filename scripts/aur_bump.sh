#!/bin/sh

set -e

VERSION=$(git describe --tags --abbrev=0 | tr -d 'v')
SHASUM=$(sha256sum "dist/VencordDesktop-$VERSION.tar.gz" | awk '{ print $1 }')

git clone ssh://aur@aur.archlinux.org/vencord-desktop-bin.git aurpkg

cd aurpkg

sed -i "s/^pkgver=.*$/pkgver=$VERSION/" PKGBUILD
sed -i "s/^sha256sums=('.*'/sha256sums=('$SHASUM'/" PKGBUILD
makepkg --printsrcinfo > .SRCINFO

git commit -a -m "Bump version to $VERSION"
git push

cd ..
rm -rf aurpkg
