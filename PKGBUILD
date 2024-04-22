# Maintainer:

_pkgname="vesktop"
pkgname="$_pkgname-git"
pkgdesc="A standalone Electron app that loads Discord & Vencord"
pkgver=0.4.1.r115.g1c2960ee
pkgrel=2
url="https://github.com/D3SOX/Vesktop"
license=('GPL-3.0-only')
arch=("any")

depends=(
  'electron29'
)
makedepends=(
  'git'
  'pnpm'
)
optdepends=(
  'libnotify: Notifications'
  'xdg-utils: Open links, files, etc'
)

provides=("$_pkgname=${pkgver%%.r*}")
conflicts=(
  "$_pkgname"
  "vencord"
)

_pkgsrc="$_pkgname"
source=("$_pkgsrc"::"git+$url.git#branch=mybuild")
sha256sums=('SKIP')

pkgver() {
  cd "$_pkgsrc"
  git describe --long --tags --abbrev=8 --exclude='*[a-zA-Z][a-zA-Z]*' \
    | sed -E 's/^[^0-9]*//;s/([^-]*-g)/r\1/;s/-/./g'
}

build() {
  export SYSTEM_ELECTRON_VERSION=$(</usr/lib/electron29/version)
  export ELECTRONVERSION=${SYSTEM_ELECTRON_VERSION%%.*}

  sed -E -e 's&^(\s*)("electron"): "(.*)"(,?)$&\1\2: "'"$SYSTEM_ELECTRON_VERSION"'"\4&' -e '/linux/s&^&"electronDist": "/usr/lib/electron29",\n&' -i "$_pkgsrc/package.json"

  cd "$_pkgsrc"
  pnpm i
  pnpm package:dir
}

package() {
  local _install_path="usr/lib"
  install -d "$pkgdir/$_install_path/$_pkgname"
  cp --reflink=auto -r "$_pkgsrc/dist/linux-unpacked/resources/app.asar" "$pkgdir/$_install_path/$_pkgname/"

  install -Dm644 "$_pkgsrc/static/icon.png" "$pkgdir/usr/share/pixmaps/$_pkgname.png"
  install -Dm644 "$_pkgsrc/LICENSE" -t "$pkgdir/usr/share/licenses/$pkgname/"

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/$_pkgname" <<END
#!/bin/sh
exec electron29 /$_install_path/$_pkgname/app.asar "\$@"
END

  install -Dm755 /dev/stdin "$pkgdir/usr/share/applications/$_pkgname.desktop" <<END
[Desktop Entry]
Name=Vesktop
GenericName=Internet Messenger
Comment=$pkgdesc
Type=Application
Exec=$_pkgname --ozone-platform-hint=x11 %U
Icon=$_pkgname
Categories=Network;InstantMessaging;
StartupWMClass=Vesktop;
Keywords=discord;vencord;vesktop
END

}
