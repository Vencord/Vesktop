#![doc(
    html_logo_url = "https://raw.githubusercontent.com/serenity-rs/songbird/current/songbird.png",
    html_favicon_url = "https://raw.githubusercontent.com/serenity-rs/songbird/current/songbird-ico.png"
)]
#![cfg_attr(docsrs, feature(doc_auto_cfg))]
#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]
//! ![project logo][logo]
//!
//! Songbird is an async, cross-library compatible voice system for Discord, written in Rust.
//! The library offers:
//!  * A standalone gateway frontend compatible with [serenity] and [twilight] using the
//!    `"gateway"` and `"[serenity/twilight]"` plus `"[rustls/native]"` features. You can even run
//!    driverless, to help manage your [lavalink] sessions.
//!  * A standalone driver for voice calls, via the `"driver"` feature. If you can create
//!    a `ConnectionInfo` using any other gateway, or language for your bot, then you
//!    can run the songbird voice driver.
//!  * Voice receive and RT(C)P packet handling via the `"receive"` feature.
//!  * And, by default, a fully featured voice system featuring events, queues,
//!    seeking on compatible streams, shared multithreaded audio stream caches,
//!    and direct Opus data passthrough from DCA files.
//!
//! ## Intents
//! Songbird's gateway functionality requires you to specify the `GUILD_VOICE_STATES` intent.
//!
//! ## Examples
//! Full examples showing various types of functionality and integrations can be found
//! in [this crate's examples directory].
//!
//! ## Codec support
//! Songbird supports all [codecs and formats provided by Symphonia] (pure-Rust), with Opus support
//! provided by [opus2] (an FFI wrapper for libopus).
//!
//! **By default, *Songbird will not request any codecs from Symphonia*.** To change this, in your own
//! project you will need to depend on Symphonia as well.
//!
//! ```toml
//! # Including songbird alone gives you support for Opus via the DCA file format.
//! [dependencies.songbird]
//! version = "0.5"
//! features = ["builtin-queue"]
//!
//! # To get additional codecs, you *must* add Symphonia yourself.
//! # This includes the default formats (MKV/WebM, Ogg, Wave) and codecs (FLAC, PCM, Vorbis)...
//! [dependencies.symphonia]
//! version = "0.5"
//! features = ["aac", "mp3", "isomp4", "alac"] # ...as well as any extras you need!
//! ```
//!
//! ## Attribution
//!
//! Songbird's logo is based upon the copyright-free image ["Black-Capped Chickadee"] by George Gorgas White.
//!
//! [logo]: https://raw.githubusercontent.com/serenity-rs/songbird/current/songbird.png
//! [serenity]: https://github.com/serenity-rs/serenity
//! [twilight]: https://github.com/twilight-rs/twilight
//! [this crate's examples directory]: https://github.com/serenity-rs/songbird/tree/current/examples
//! ["Black-Capped Chickadee"]: https://www.oldbookillustrations.com/illustrations/black-capped-chickadee/
//! [`ConnectionInfo`]: struct@ConnectionInfo
//! [lavalink]: https://github.com/freyacodes/Lavalink
//! [codecs and formats provided by Symphonia]: https://github.com/pdeljanov/Symphonia#formats-demuxers
//! [opus2]: https://github.com/cijiugechu/opus2

#![warn(clippy::pedantic, rust_2018_idioms)]
#![allow(
    // Allowed as they are too pedantic
    clippy::module_name_repetitions,
    clippy::wildcard_imports,
    clippy::too_many_lines,
    clippy::cast_lossless,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    // TODO: would require significant rewriting of all existing docs
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_link_with_quotes,
    clippy::doc_markdown,
)]

mod config;
pub mod constants;
#[cfg(feature = "driver")]
pub mod driver;
pub mod error;
#[cfg(feature = "driver")]
pub mod events;
mod float_duration;
#[cfg(feature = "gateway")]
mod handler;
pub mod id;
pub(crate) mod info;
#[cfg(feature = "driver")]
pub mod input;
#[cfg(feature = "gateway")]
pub mod join;
#[cfg(feature = "gateway")]
mod manager;
#[cfg(feature = "serenity")]
pub mod serenity;
#[cfg(feature = "gateway")]
pub mod shards;
#[cfg(any(test, feature = "internals"))]
pub mod test_utils;
#[cfg(feature = "driver")]
pub mod tracks;
#[cfg(feature = "driver")]
mod ws;

#[cfg(all(feature = "driver", feature = "receive"))]
pub use discortp as packet;
#[cfg(feature = "driver")]
pub use serenity_voice_model as model;

pub(crate) use serde_json as json;

#[cfg(feature = "driver")]
pub use crate::{
    driver::Driver,
    events::{CoreEvent, Event, EventContext, EventHandler, TrackEvent},
};

#[cfg(feature = "gateway")]
pub use crate::{handler::*, manager::*};

#[cfg(feature = "serenity")]
pub use crate::serenity::*;

pub use config::Config;
pub use float_duration::FloatDuration;
pub use info::ConnectionInfo;
