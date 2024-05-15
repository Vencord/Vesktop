# Vesktop (D3SOX)

Vesktop is a custom Discord desktop app. This is my personal branch with some extra features and tweaks.

**Extra features compared to [Vencord/Vesktop](https://github.com/Vencord/Vesktop) main**:
- Global Keybinds (X11, KDE Wayland works too if enabled in System Settings)
- Tray icon voice detection

**Main features**:
- Vencord preinstalled
- Much more lightweight and faster than the official Discord app
- Linux Screenshare with sound & wayland
- Much better privacy, since Discord has no access to your system

**Not yet supported**:
- see the [Roadmap](https://github.com/Vencord/Vesktop/issues/324)

![](https://github.com/Vencord/Vesktop/assets/45497981/8608a899-96a9-4027-9725-2cb02ba189fd)
![](https://github.com/Vencord/Vesktop/assets/45497981/8701e5de-52c4-4346-a990-719cb971642e)

## Installing

### Windows

If you don't know the difference, pick the Installer.

- [Installer](https://vencord.dev/download/vesktop/amd64/windows)
- [Portable](https://vencord.dev/download/vesktop/amd64/windows-portable)

### Mac

If you don't know the difference, pick the Intel build.

- [Intel build (amd64)](https://vencord.dev/download/vesktop/amd64/dmg)
- [Apple Silicon (arm64)](https://vencord.dev/download/vesktop/arm64/dmg)

### Linux

[![Download on Flathub](https://dl.flathub.org/assets/badges/flathub-badge-en.svg)](https://flathub.org/apps/dev.vencord.Vesktop)

If you don't know the difference, pick amd64.

- amd64 / x86_64
  - [AppImage](https://vencord.dev/download/vesktop/amd64/appimage)
  - [Ubuntu/Debian (.deb)](https://vencord.dev/download/vesktop/amd64/deb)
  - [Fedora/RHEL (.rpm)](https://vencord.dev/download/vesktop/amd64/rpm)
  - [tarball](https://vencord.dev/download/vesktop/amd64/tar)
- arm64 / aarch64
  - [AppImage](https://vencord.dev/download/vesktop/arm64/appimage)
  - [Ubuntu/Debian (.deb)](https://vencord.dev/download/vesktop/arm64/deb)
  - [Fedora/RHEL (.rpm)](https://vencord.dev/download/vesktop/arm64/rpm)
  - [tarball](https://vencord.dev/download/vesktop/arm64/tar)

#### Community packages

Below you can find unofficial packages created by the community. They are not officially supported by us, so before reporting issues, please first confirm the issue also happens on official builds. When in doubt, consult with their packager first. The flatpak and AppImage should work on any distro that [supports them](https://flatpak.org/setup/), so I recommend you just use those instead!

- Arch Linux: [Vesktop on the Arch user repository](https://aur.archlinux.org/packages?K=vesktop)
- NixOS: https://wiki.nixos.org/wiki/Discord#Vesktop
- Windows - Scoop: https://scoop.sh/#/apps?q=Vesktop

## Building from Source

Packaging will create builds in the dist/ folder

```sh
git clone https://github.com/Vencord/Vesktop
cd Vesktop

# Install Dependencies
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
