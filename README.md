# Vesktop

Vesktop is a cross platform desktop app aiming to give you a snappier Discord experience with Vencord pre-installed

**Not yet supported**:
- Global Keybinds

Bug reports, feature requests & contributions are highly appreciated!!

![image](https://user-images.githubusercontent.com/45497981/235024615-94565eaf-f412-4384-a3f5-d8cde7458f6d.png)

## Installing

### Windows

Download and run Vesktop-Setup-VERSION.exe from [releases](https://github.com/Vencord/Vesktop/releases/latest)

### Mac

Download and run Vesktop-VERSION.dmg from [releases](https://github.com/Vencord/Vesktop/releases/latest)

### Linux

#### Arch based

Install [vencord-desktop-git](https://aur.archlinux.org/packages/vencord-desktop-git) from the AUR using your favourite AUR helper, for example [yay](https://github.com/Jguer/yay)

#### Ubuntu/Debian based

Download Vesktop-VERSION.deb from [releases](https://github.com/Vencord/Vesktop/releases/latest)

#### Fedora/RHEL based

Download Vesktop-VERSION.rpm from [releases](https://github.com/Vencord/Vesktop/releases/latest)

#### Other

Either download Vesktop-VERSION.AppImage and just run it directly or grab Vesktop-VERSION.tar.gz, extract it somewhere and run `vencorddesktop`.

A flatpak is planned, if you want packages for other repos, feel free to create them and they can be linked as unofficial here

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

This is just a random idea I (V) got, and might not actually ever be finished heh

Gluon also seems very attractive for this because of how lightweight it can be and because unlike electron, streaming just works out of the box like in any chromium browser. However, at the time of writing this, it still lacks some features necessary to make it work (synchronous ipc or a way to get node process variables into the onLoad function for instance, plus onLoad seems to load a little too late sometimes)
