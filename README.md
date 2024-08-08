# Equibop [<img src="/static/icon.png" width="225" align="right" alt="Equibop">](https://github.com/Equicord/Equibop)

[![Equicord](https://img.shields.io/badge/Equicord-grey?style=flat)](https://github.com/Equicord/Equicord)
[![Tests](https://github.com/Equicord/Equibop/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/Equicord/Equibop/actions/workflows/test.yml)
[![Discord](https://img.shields.io/discord/1207691698386501634.svg?color=768AD4&label=Discord&logo=discord&logoColor=white)](https://discord.gg/5Xh2W87egW)

Equibop is a fork of [Vesktop](https://github.com/Vencord/Vesktop).

You can join our [discord server](https://discord.gg/5Xh2W87egW) for commits, changes, chat or even support.<br></br>

## Main features

-   Much more lightweight and faster than the official Discord app
-   Linux Screenshare with sound & wayland

**Extra included changes**

-   Equicord preinstalled
-   Custom Splash animations from [this PR](https://github.com/Vencord/Vesktop/pull/355)
-   Tray Customization & Voice detection and Badge from [this PR](https://github.com/Vencord/Vesktop/pull/517)
-   Remove (#) title prefix when Notification Badge option is toggled from [this PR](https://github.com/Vencord/Vesktop/pull/686)

**Not yet supported**:

-   Global Keybinds

## Installing

### Windows

If you don't know the difference, pick the Installer.

-   Installer
    -   [Universal](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-win.exe)
    -   [x64 / amd64](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-win-x64.exe)
    -   [arm64](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-win-arm64.exe)
-   Portable
    -   [x64 / amd64](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-win-x64.zip)
    -   [arm64](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-win-arm64.zip)

### Mac

These work on both M Series and Intel Series Macs
-   [DMG](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-mac-universal.dmg)
-   [ZIP](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-mac-universal.zip)

### Linux

If you don't know the difference, pick amd64.

-   amd64 / x86_64
    -   [AppImage](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-x86_64.AppImage)
    -   [Ubuntu/Debian (.deb)](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-amd64.deb)
    -   [Fedora/RHEL (.rpm)](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-x86_64.rpm)
    -   [tarball](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-x64.tar.gz)
-   arm64 / aarch64
    -   [AppImage](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-arm64.AppImage)
    -   [Ubuntu/Debian (.deb)](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-arm64.deb)
    -   [Fedora/RHEL (.rpm)](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-aarch64.rpm)
    -   [tarball](https://github.com/Equicord/Equibop/releases/latest/download/Equibop-linux-arm64.tar.gz)

## Building from Source

Packaging will create builds in the dist/ folder

> [!NOTE]
> On Windows, if you run the test script, you will get test errors about venmic, you can ignore these as it's a linux only module.

```sh
git clone https://github.com/Equicord/Equibop
cd Equibop

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
