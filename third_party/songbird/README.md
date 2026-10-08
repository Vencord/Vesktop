[![crates.io badge]][crates.io] [![build badge]][build] [![docs badge]][docs] [![current docs badge]][current docs] [![next docs badge]][next docs] [![msrv badge]][msrv] [![license badge]][license] [![guild badge]][guild]

# Songbird

![](songbird.png)

Songbird is an async, cross-library compatible voice system for Discord, written in Rust.
The library offers:
 * A standalone gateway frontend compatible with [serenity] and [twilight] using the
 `"gateway"` and `"[serenity/twilight]"` plus `"[rustls/native]"` features. You can even run
 driverless, to help manage your [lavalink] sessions.
 * A standalone driver for voice calls, via the `"driver"` feature. If you can create
 a `ConnectionInfo` using any other gateway, or language for your bot, then you
 can run the songbird voice driver.
 * Voice receive and RT(C)P packet handling via the `"receive"` feature.
 * And, by default, a fully featured voice system featuring events, queues,
 seeking on compatible streams, shared multithreaded audio stream caches,
 and direct Opus data passthrough from DCA files.

## Intents
Songbird's gateway functionality requires you to specify the `GUILD_VOICE_STATES` intent.

## Codec support
Songbird supports all [codecs and formats provided by Symphonia] (pure-Rust), with Opus support
provided by [opus2] (an FFI wrapper for libopus).

**By default, *Songbird will not request any codecs from Symphonia*.** To change this, in your own
project you will need to depend on Symphonia as well.

```toml
# Including songbird alone gives you support for Opus via the DCA file format.
[dependencies.songbird]
version = "0.5"
features = ["builtin-queue"]

# To get additional codecs, you *must* add Symphonia yourself.
# This includes the default formats (MKV/WebM, Ogg, Wave) and codecs (FLAC, PCM, Vorbis)...
[dependencies.symphonia]
version = "0.5"
features = ["aac", "mp3", "isomp4", "alac"] # ...as well as any extras you need!
```

## Dependencies
Songbird needs a few system dependencies before you can use it.

- Opus - Audio codec that Discord uses.
[opus2] will use installed libopus binaries if available via pkgconf on Linux/MacOS, otherwise you will need to install cmake to build opus from source.
This is always the case on Windows.
For Unix systems, you can install the library with `apt install libopus-dev` on Ubuntu or `pacman -S opus` on Arch Linux.
If you do not have it installed it will be built for you. However, you will need a C compiler and the GNU autotools installed.
Again, these can be installed with `apt install build-essential autoconf automake libtool m4` on Ubuntu or `pacman -S base-devel` on Arch Linux.

This is a required dependency. Songbird cannot work without it.

- yt-dlp / youtube-dl / (similar forks) - Audio/Video download tool.
yt-dlp can be installed [according to the installation instructions on the main repo].
You can install youtube-dl with Python's package manager, pip, which we recommend for youtube-dl. You can do it with the command `pip install youtube_dl`.
Alternatively, you can install it with your system's package manager, `apt install youtube-dl` on Ubuntu or `pacman -S youtube-dl` on Arch Linux.

This is an optional dependency for users, but is required as a dev-dependency. It allows Songbird to download audio/video sources from the Internet from a variety of webpages, which it will convert to the Opus audio format Discord uses.

## Examples
Full examples showing various types of functionality and integrations can be found in [this crate's examples directory].

## Contributing
If you want to help out or file an issue, please look over [our contributor guidelines]!

## Attribution
Songbird's logo is based upon the copyright-free image ["Black-Capped Chickadee"] by George Gorgas White.

[serenity]: https://github.com/serenity-rs/serenity
[twilight]: https://github.com/twilight-rs/twilight
["Black-Capped Chickadee"]: https://www.oldbookillustrations.com/illustrations/black-capped-chickadee/
[lavalink]: https://github.com/freyacodes/Lavalink
[this crate's examples directory]: https://github.com/serenity-rs/songbird/tree/current/examples
[our contributor guidelines]: CONTRIBUTING.md
[codecs and formats provided by Symphonia]: https://github.com/pdeljanov/Symphonia#formats-demuxers
[opus2]: https://github.com/cijiugechu/opus2
[according to the installation instructions on the main repo]: https://github.com/yt-dlp/yt-dlp#installation

<!-- Badges -->
[crates.io]: https://crates.io/crates/songbird
[crates.io badge]: https://img.shields.io/crates/v/songbird.svg?style=flat-square
[build]: https://github.com/serenity-rs/songbird/actions
[build badge]: https://img.shields.io/github/actions/workflow/status/serenity-rs/songbird/ci.yml?branch=current&style=flat-square
[docs]: https://docs.rs/songbird/
[docs badge]: https://img.shields.io/badge/docs-online-informational?style=flat-square
[current docs]: https://serenity-rs.github.io/songbird/current/songbird/index.html
[current docs badge]: https://img.shields.io/badge/docs-current-4d76ae.svg?style=flat-square
[next docs]: https://serenity-rs.github.io/songbird/next/songbird/index.html
[next docs badge]: https://img.shields.io/badge/docs-next-4d76ae.svg?style=flat-square
[msrv]: https://blog.rust-lang.org/2024/11/28/Rust-1.83.0.html
[msrv badge]: https://img.shields.io/badge/rust-1.83+-93450a.svg?style=flat-square
[license]: LICENSE
[license badge]: https://img.shields.io/crates/l/songbird.svg?style=flat-square&color=yellow
[guild]: https://discord.gg/serenity-rs
[guild badge]: https://img.shields.io/discord/381880193251409931.svg?style=flat-square&colorB=7289DA
