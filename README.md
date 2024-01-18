# Vesktop

Vesktop is a cross platform desktop app aiming to give you a snappier Discord experience with [Vencord](https://github.com/Vendicated/Vencord) pre-installed

**Not yet supported**:

-   Global Keybinds

Bug reports, feature requests & contributions are highly appreciated!!

![](https://github.com/Vencord/Vesktop/assets/45497981/8608a899-96a9-4027-9725-2cb02ba189fd)
![grafik](https://github.com/Vencord/Vesktop/assets/45497981/8701e5de-52c4-4346-a990-719cb971642e)

## Installing

### Windows

Download and run Vesktop-Setup-VERSION.exe from [releases](https://github.com/Vencord/Vesktop/releases/latest)

### Mac

Download and run Vesktop-VERSION.dmg from [releases](https://github.com/Vencord/Vesktop/releases/latest)

### Linux

[![](https://dl.flathub.org/assets/badges/flathub-badge-en.svg)](https://flathub.org/apps/dev.vencord.Vesktop)

#### Arch based

Install [vencord-desktop-git](https://aur.archlinux.org/packages/vencord-desktop-git) from the AUR using your favourite AUR helper, for example [yay](https://github.com/Jguer/yay)

#### Ubuntu/Debian based

Download Vesktop-VERSION.deb from [releases](https://github.com/Vencord/Vesktop/releases/latest)

#### Fedora/RHEL based

Download Vesktop-VERSION.rpm from [releases](https://github.com/Vencord/Vesktop/releases/latest)

#### Other

Either download Vesktop-VERSION.AppImage and just run it directly or grab Vesktop-VERSION.tar.gz, extract it somewhere and run `vesktop`.

If other packages are created, feel free to open an issue and we'll link them here.

## Building

Packaging will create builds in the dist/ folder. You can then install them like mentioned above or distribute them

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

## Motivation

The official Discord Desktop app is very resource heavy compared to Discord in your Browser. There are multiple alternative Electron apps (ArmCord, WebCord, probably more) that prove how much of a performance gain you can gain by using a custom app. ArmCord already supports Vencord but makes it pretty limited for us. Making our own standalone app gives us much more control.
