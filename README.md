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

## Installing

### Arch Linux

```sh
git clone https://github.com/D3SOX/Vesktop
cd Vesktop
makepkg -rsifc
```

## Building from Source

Packaging will create builds in the dist/ folder

```sh
git clone https://github.com/D3SOX/Vesktop
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
