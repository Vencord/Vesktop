# Equitop [<img src="https://avatars.githubusercontent.com/u/150590884" width="225" align="right" alt="Equitop">](https://github.com/Equicord/Equitop)

[![Equicord](https://img.shields.io/badge/Equicord-green?style=flat)](https://github.com/Equicord/Equitop)
[![Tests](https://github.com/Equicord/Equitop/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/Equicord/Equitop/actions/workflows/test.yml)
[![Discord](https://img.shields.io/discord/1207691698386501634.svg?color=768AD4&label=Discord&logo=discord&logoColor=white)](https://discord.gg/5Xh2W87egW)

Equitop is a fork of [Vesktop](https://github.com/Vencord/Vesktop).

You can join our [discord server](https://discord.gg/5Xh2W87egW) for commits, changes, chat or even support.<br></br>

## Main features

-   Much more lightweight and faster than the official Discord app
-   Linux Screenshare with sound & wayland

**Extra included changes**

-   Equicord preinstalled
-   Custom Splash animations from [this PR](https://github.com/Vencord/Vesktop/pull/355)

**Not yet supported**:

-   Global Keybinds

## Installing

### Windows

If you don't know the difference, pick the Installer.

-   [Installer](https://github.com/Equicord/Equitop/releases/latest/download/Equitop-Setup-1.6.1.exe)
-   Portable
    -   [x64 / amd64](<(https://github.com/Equicord/Equitop/releases/latest/download/Equitop-1.6.1-win.zip)>)
    -   [arm64](https://github.com/Equicord/Equitop/releases/download/v1.6.1/Equitop-1.6.1-arm64-win.zip)

### Mac

If you don't know the difference, pick the Intel build.

-   [Equitop.dmg](https://github.com/Equicord/Equitop/releases/download/v1.6.1/Equitop-1.6.1-universal.dmg)

### Linux

If you don't know the difference, pick amd64.

-   amd64 / x86_64
    -   [AppImage](https://github.com/Equicord/Equitop/releases/latest/download/Equitop-1.6.1.AppImage)
    -   [Ubuntu/Debian (.deb)](https://github.com/Equicord/Equitop/releases/latest/download/equitop_1.6.1_amd64.deb)
    -   [Fedora/RHEL (.rpm)](https://github.com/Equicord/Equitop/releases/latest/download/equitop-1.6.1.x86_64.rpm)
    -   [tarball](https://github.com/Equicord/Equitop/releases/latest/download/equitop-1.6.1.tar.gz)
-   arm64 / aarch64
    -   [AppImage](https://github.com/Equicord/Equitop/releases/latest/download/Equitop-1.6.1-arm64.AppImage)
    -   [Ubuntu/Debian (.deb)](https://github.com/Equicord/Equitop/releases/latest/download/equitop_1.6.1_arm64.deb)
    -   [Fedora/RHEL (.rpm)](https://github.com/Equicord/Equitop/releases/latest/download/equitop-1.6.1.aarch64.rpm)
    -   [tarball](https://github.com/Equicord/Equitop/releases/latest/download/equitop-1.6.1-arm64.tar.gz)

## Building from Source

Packaging will create builds in the dist/ folder

> [!NOTE]
> On Windows, if you run the test script, you will get test errors about venmic, you can ignore these as it's a linux only module.

```sh
git clone https://github.com/Equicord/Equitop
cd Equitop

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
