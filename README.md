# Vesktop

<img align="right" width="64" src="static/shiggy.gif">
<img align="right" width="64" src="https://avatars.githubusercontent.com/u/113042587">

Vesktop is a custom Discord Desktop app.

## Main features

- Vencord pre-installed.
- Much more lightweight and faster than the official Discord app.
- Linux screenshare with sound and Wayland compatibility.
- Much better privacy, since Discord has no access to your system.
- Fixes scroll issues and other issues/nuisances present on the official Discord app for Linux.

### Not yet supported

- Global keybinds.
- For other things, see the [roadmap](https://github.com/Vencord/Vesktop/issues/324).

## Screenshots

<table>
<tr>
<th colspan="3">Linux Screenshare</th>
</tr>
<tr>
<td><img src="https://github.com/Vencord/Vesktop/assets/37805707/2f8259b7-f9e6-47c4-b801-dacbef30027a"/></td>
<td><img src="https://github.com/Vencord/Vesktop/assets/37805707/4d1e1136-b7ac-4db5-afaf-0f8e425157db"/></td>
<td><img src="https://github.com/Vencord/Vesktop/assets/37805707/536a4275-eb37-46a3-8f24-cf351e5ef10e"/></td>
</tr>
</table>

## Installing

### Windows

We recommend the installer.

- [Installer](https://vencord.dev/download/vesktop/amd64/windows)
- [Portable](https://vencord.dev/download/vesktop/amd64/windows-portable)

### MacOS

If you don't know the difference, pick the Intel build.

- [Intel build (amd64)](https://vencord.dev/download/vesktop/amd64/dmg)
- [Apple Silicon (arm64)](https://vencord.dev/download/vesktop/arm64/dmg)

### Linux

Flathub provides both `amd64` (`x86_64`) and `arm64` (`aarch64`) builds on a single standalone.

[![Download on Flathub](https://dl.flathub.org/assets/badges/flathub-badge-en.svg)](https://flathub.org/apps/dev.vencord.Vesktop)

If you prefer a native package for your distribution, check the list below.

To check which version is appropriate for your system, type `uname -m` in a terminal window.

- `amd64` (`x86_64`)
  - [AppImage](https://vencord.dev/download/vesktop/amd64/appimage)
  - [Ubuntu/Debian (.deb)](https://vencord.dev/download/vesktop/amd64/deb)
  - [Fedora/RHEL (.rpm)](https://vencord.dev/download/vesktop/amd64/rpm)
  - [tarball](https://vencord.dev/download/vesktop/amd64/tar)

- `arm64` (`aarch64`)
  - [AppImage](https://vencord.dev/download/vesktop/arm64/appimage)
  - [Ubuntu/Debian (.deb)](https://vencord.dev/download/vesktop/arm64/deb)
  - [Fedora/RHEL (.rpm)](https://vencord.dev/download/vesktop/arm64/rpm)
  - [tarball](https://vencord.dev/download/vesktop/arm64/tar)

#### Community packages

> [!NOTE]
> There are unofficial packages created by the community. They are not officially supported by us; so, before reporting issues, please first confirm the issue also happens on official builds. When in doubt, consult with their packager first.
> The Flatpak and AppImage should work on any distro that [supports them](https://flatpak.org/setup/), so I recommend you just use those instead!

- Arch Linux: [Vesktop on the Arch User Repository (AUR)](https://aur.archlinux.org/packages?K=vesktop)
- NixOS: https://wiki.nixos.org/wiki/Discord#Vesktop
- Windows (via Scoop): https://scoop.sh/#/apps?q=Vesktop

## Building from source

Packaging will create builds in the <kdb>dist/</kbd> folder

```sh
git clone https://github.com/Vencord/Vesktop
cd Vesktop

# Install dependencies
pnpm i

# Either run it without packaging
pnpm start

# Or package
pnpm package
# Or only build the pacman target
pnpm package --linux pacman
# Or package to a directory only
pnpm package:dir
```

# Licensing

This project is licensed under the GNU General Public License (GPL) version 3, or, at your option, any later version.

See the [<kdb>LICENSE</kbd>](LICENSE) file for more details.
