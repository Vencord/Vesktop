#!/usr/bin/bash
set -exuo pipefail

cd ~

install -d -m 0700 ~/.ssh
echo "$AUR_SSH_PRIVATE_KEY" > ~/.ssh/aur
chmod 0600 ~/.ssh/aur
cat > ~/.ssh/config <<'EOF'
Host aur.archlinux.org
    User aur
    IdentityFile ~/.ssh/aur
    IdentitiesOnly yes
EOF
chmod 0600 ~/.ssh/config
ssh-keyscan aur.archlinux.org >> ~/.ssh/known_hosts
chmod 0600 ~/.ssh/known_hosts

git clone ssh://aur@aur.archlinux.org/vesktop-bin.git aur
cd aur

export TERM=xterm # without this, pkgctl EXPLODES
pkgctl version upgrade
makepkg --printsrcinfo > .SRCINFO

makepkg --syncdeps --noconfirm

git add PKGBUILD .SRCINFO

if git diff --cached --quiet; then
    echo "AUR package is already up to date"
    exit 0
fi

if [[ "$AUR_EVENT_NAME" == workflow_dispatch ]]; then
    echo "Skipping push for workflow dispatch"
    exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git commit -m "Update vesktop-bin to $AUR_RELEASE_TAG"
git push
