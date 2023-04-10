#!/bin/sh

set -e

for i in \
	"makepkg_6.0.2-3_amd64.deb" \
	"libalpm13_13.0.2-3_amd64.deb" \
	"pacman-package-manager_6.0.2-3_amd64.deb"; do
	wget -O/tmp/$i https://fr.archive.ubuntu.com/ubuntu/pool/universe/p/pacman-package-manager/$i
	dpkg -i /tmp/$i || true
done

apt -f install -q
