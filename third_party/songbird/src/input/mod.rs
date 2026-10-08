//! Raw audio input data streams and sources.
//!
//! [`Input`]s in Songbird are based on [symphonia], which provides demuxing,
//! decoding and management of synchronous byte sources (i.e., any items which
//! `impl` [`Read`]).
//!
//! Songbird adds support for the Opus codec to symphonia via [`OpusDecoder`],
//! the [DCA1] file format via [`DcaReader`], and a simple PCM adapter via [`RawReader`];
//! the [format] and [codec registries] in [`codecs`] install these on top of those
//! enabled in your `Cargo.toml` when you include symphonia.
//!
//! ## Common sources
//! * Any owned byte slice: `&'static [u8]`, `Bytes`, or `Vec<u8>`,
//! * [`File`] offers a lazy way to open local audio files,
//! * [`HttpRequest`] streams a given file from a URL using the reqwest HTTP library,
//! * [`YoutubeDl`] uses `yt-dlp` (or any other `youtube-dl`-like program) to scrape
//!   a target URL for a usable audio stream, before opening an [`HttpRequest`].
//!
//! ## Adapters
//! Songbird includes several adapters to make developing your own inputs easier:
//! * [`cached::*`], which allow seeking and shared caching of an input stream (storing
//!   it in memory in a variety of formats),
//! * [`ChildContainer`] for managing audio given by a process chain,
//! * [`RawAdapter`], for feeding in a synchronous `f32`-PCM stream, and
//! * [`AsyncAdapterStream`], for passing bytes from an `AsyncRead` (`+ AsyncSeek`) stream
//!   into the mixer.
//!
//! ## Opus frame passthrough.
//! Some sources, such as [`Compressed`] or any WebM/Opus/DCA file, support
//! direct frame passthrough to the driver. This lets you directly send the
//! audio data you have *without decoding, re-encoding, or mixing*. In many
//! cases, this can greatly reduce the CPU cost required by the driver.
//!
//! This functionality requires that:
//!  * only one track is active (including paused tracks),
//!  * that track's input supports direct Opus frame reads,
//!  * this input's frames are all sized to 20ms.
//!  * and that track's volume is set to `1.0`.
//!
//! [`Input`]s which are almost suitable but which have **any** illegal frames will be
//! blocked from passthrough to prevent glitches such as repeated encoder frame gaps.
//!
//! [symphonia]: https://docs.rs/symphonia
//! [`Read`]: https://doc.rust-lang.org/std/io/trait.Read.html
//! [`Compressed`]: cached::Compressed
//! [DCA1]: https://github.com/bwmarrin/dca
//! [`cached::*`]: cached
//! [`OpusDecoder`]: codecs::OpusDecoder
//! [`DcaReader`]: codecs::DcaReader
//! [`RawReader`]: codecs::RawReader
//! [format]: codecs::get_probe
//! [codec registries]: codecs::get_codec_registry

mod adapters;
mod audiostream;
pub mod codecs;
mod compose;
mod error;
#[cfg(test)]
pub mod input_tests;
mod live_input;
pub mod metadata;
mod parsed;
mod sources;
pub mod utils;

pub use self::{
    adapters::*,
    audiostream::*,
    compose::*,
    error::*,
    live_input::*,
    metadata::{AuxMetadata, Metadata},
    parsed::*,
    sources::*,
};

pub use symphonia_core as core;

use std::{error::Error, io::Cursor};
use symphonia_core::{codecs::CodecRegistry, probe::Probe};
use tokio::runtime::Handle as TokioHandle;

/// An audio source, which can be live or lazily initialised.
///
/// This can be created from a wide variety of sources:
/// * Any owned byte slice: `&'static [u8]`, `Bytes`, or `Vec<u8>`,
/// * [`File`] offers a lazy way to open local audio files,
/// * [`HttpRequest`] streams a given file from a URL using the reqwest HTTP library,
/// * [`YoutubeDl`] uses `yt-dlp` (or any other `youtube-dl`-like program) to scrape
///   a target URL for a usable audio stream, before opening an [`HttpRequest`].
///
/// Any [`Input`] (or struct with `impl Into<Input>`) can also be made into a [`Track`] via
/// `From`/`Into`.
///
/// # Example
///
/// ```
/// # use tokio::runtime;
/// #
/// # let basic_rt = runtime::Builder::new_current_thread().enable_io().build().unwrap();
/// # basic_rt.block_on(async {
/// use songbird::{
///     driver::Driver,
///     input::{codecs::*, Compose, Input, MetadataError, YoutubeDl},
///     tracks::Track,
/// };
/// // Inputs are played using a `Driver`, or `Call`.
/// let mut driver = Driver::new(Default::default());
///
/// // Lazy inputs take very little resources, and don't occupy any resources until we
/// // need to play them (by default).
/// let mut lazy = YoutubeDl::new(
///     reqwest::Client::new(),
///     // Referenced under CC BY-NC-SA 3.0 -- https://creativecommons.org/licenses/by-nc-sa/3.0/
///     "https://cloudkicker.bandcamp.com/track/94-days",
/// );
/// let lazy_c = lazy.clone();
///
/// // With sources like `YoutubeDl`, we can get metadata from, e.g., a track's page.
/// let aux_metadata = lazy.aux_metadata().await.unwrap();
/// assert_eq!(aux_metadata.track, Some("94 Days".to_string()));
///
/// // Once we pass an `Input` to the `Driver`, we can only remotely control it via
/// // a `TrackHandle`.
/// let handle = driver.play_input(lazy.into());
///
/// // We can also modify some of its initial state via `Track`s.
/// let handle = driver.play(Track::from(lazy_c).volume(0.5).pause());
///
/// // In-memory sources like `Vec<u8>`, or `&'static [u8]` are easy to use, and only take a
/// // little time for the mixer to parse their headers.
/// // You can also use the adapters in `songbird::input::cached::*`to keep a source
/// // from the Internet, HTTP, or a File in-memory *and* share it among calls.
/// let in_memory = include_bytes!("../../resources/ting.mp3");
/// let mut in_memory_input = in_memory.into();
///
/// // This source is live...
/// assert!(matches!(in_memory_input, Input::Live(..)));
/// // ...but not yet playable, and we can't access its `Metadata`.
/// assert!(!in_memory_input.is_playable());
/// assert!(matches!(in_memory_input.metadata(), Err(MetadataError::NotParsed)));
///
/// // If we want to inspect metadata (and we can't use AuxMetadata for any reason), we have
/// // to parse the track ourselves.
/// //
/// // We can access it on a live track using `TrackHandle::action()`.
/// in_memory_input = in_memory_input
///     .make_playable_async(get_codec_registry(), get_probe())
///     .await
///     .expect("WAV support is included, and this file is good!");
///
/// // Symphonia's metadata can be difficult to use: prefer `AuxMetadata` when you can!
/// use symphonia_core::meta::{StandardTagKey, Value};
/// let mut metadata = in_memory_input.metadata();
/// let meta = metadata.as_mut().unwrap();
/// let mut probed = meta.probe.get().unwrap();
///
/// let track_name = probed
///     .current().unwrap()
///     .tags().iter().filter(|v| v.std_key == Some(StandardTagKey::TrackTitle))
///     .next().unwrap();
/// if let Value::String(s) = &track_name.value {
///     assert_eq!(s, "Ting!");
/// } else { panic!() };
///
/// // ...and these are played like any other input.
/// let handle = driver.play_input(in_memory_input);
/// # });
/// ```
///
/// [`Track`]: crate::tracks::Track
pub enum Input {
    /// A byte source which is not yet initialised.
    ///
    /// When a parent track is either played or explicitly readied, the inner [`Compose`]
    /// is used to create an [`Input::Live`].
    Lazy(
        /// A trait object which can be used to (re)create a usable byte stream.
        Box<dyn Compose>,
    ),
    /// An initialised byte source.
    ///
    /// This contains a raw byte stream, the lazy initialiser that was used,
    /// as well as any symphonia-specific format data and/or hints.
    Live(
        /// The byte source, plus symphonia-specific data.
        LiveInput,
        /// The struct used to initialise this source, if available.
        ///
        /// This is used to recreate the stream when a source does not support
        /// backward seeking, if present.
        Option<Box<dyn Compose>>,
    ),
}

impl Input {
    /// Requests auxiliary metadata which can be accessed without parsing the file.
    ///
    /// This method will never be called by songbird but allows, for instance, access to metadata
    /// which might only be visible to a web crawler, e.g., uploader or source URL.
    ///
    /// This requires that the [`Input`] has a [`Compose`] available to use, otherwise it
    /// will always fail with [`AudioStreamError::Unsupported`].
    pub async fn aux_metadata(&mut self) -> Result<AuxMetadata, AuxMetadataError> {
        match self {
            Self::Lazy(ref mut composer) | Self::Live(_, Some(ref mut composer)) =>
                composer.aux_metadata().await.map_err(Into::into),
            Self::Live(_, None) => Err(AuxMetadataError::NoCompose),
        }
    }

    /// Tries to get any information about this audio stream acquired during parsing.
    ///
    /// Only exists when this input is both [`Self::Live`] and has been fully parsed.
    /// In general, you probably want to use [`Self::aux_metadata`].
    pub fn metadata(&mut self) -> Result<Metadata<'_>, MetadataError> {
        if let Self::Live(live, _) = self {
            live.metadata()
        } else {
            Err(MetadataError::NotLive)
        }
    }

    /// Initialises (but does not parse) an [`Input::Lazy`] into an [`Input::Live`],
    /// placing blocking I/O on the current thread.
    ///
    /// This requires a [`TokioHandle`] to a tokio runtime to spawn any `async` sources.
    ///
    /// *This is a blocking operation. If you wish to use this from an async task, you
    /// must do so via [`Self::make_live_async`].*
    ///
    /// This is a no-op for an [`Input::Live`].
    pub fn make_live(self, handle: &TokioHandle) -> Result<Self, AudioStreamError> {
        if let Self::Lazy(mut lazy) = self {
            let (created, lazy) = if lazy.should_create_async() {
                let (tx, rx) = flume::bounded(1);
                handle.spawn(async move {
                    let out = lazy.create_async().await;
                    drop(tx.send_async((out, lazy)));
                });
                rx.recv().map_err(|_| {
                    let err_msg: Box<dyn Error + Send + Sync> =
                        "async Input create handler panicked".into();
                    AudioStreamError::Fail(err_msg)
                })?
            } else {
                (lazy.create(), lazy)
            };

            Ok(Self::Live(LiveInput::Raw(created?), Some(lazy)))
        } else {
            Ok(self)
        }
    }

    /// Initialises (but does not parse) an [`Input::Lazy`] into an [`Input::Live`],
    /// placing blocking I/O on the a `spawn_blocking` executor.
    ///
    /// This is a no-op for an [`Input::Live`].
    pub async fn make_live_async(self) -> Result<Self, AudioStreamError> {
        if let Self::Lazy(mut lazy) = self {
            let (created, lazy) = if lazy.should_create_async() {
                (lazy.create_async().await, lazy)
            } else {
                tokio::task::spawn_blocking(move || (lazy.create(), lazy))
                    .await
                    .map_err(|_| {
                        let err_msg: Box<dyn Error + Send + Sync> =
                            "synchronous Input create handler panicked".into();
                        AudioStreamError::Fail(err_msg)
                    })?
            };

            Ok(Self::Live(LiveInput::Raw(created?), Some(lazy)))
        } else {
            Ok(self)
        }
    }

    /// Initialises and parses an [`Input::Lazy`] into an [`Input::Live`],
    /// placing blocking I/O on the current thread.
    ///
    /// This requires a [`TokioHandle`] to a tokio runtime to spawn any `async` sources.
    /// If you can't access one, then consider manually using [`LiveInput::promote`].
    ///
    /// *This is a blocking operation. Symphonia uses standard library I/O (e.g., [`Read`], [`Seek`]).
    /// If you wish to use this from an async task, you must do so within `spawn_blocking`.*
    ///
    /// [`Read`]: https://doc.rust-lang.org/std/io/trait.Read.html
    /// [`Seek`]: https://doc.rust-lang.org/std/io/trait.Seek.html
    pub fn make_playable(
        self,
        codecs: &CodecRegistry,
        probe: &Probe,
        handle: &TokioHandle,
    ) -> Result<Self, MakePlayableError> {
        let out = self.make_live(handle)?;
        match out {
            Self::Lazy(_) => unreachable!(),
            Self::Live(input, lazy) => {
                let promoted = input.promote(codecs, probe)?;
                Ok(Self::Live(promoted, lazy))
            },
        }
    }

    /// Initialises and parses an [`Input::Lazy`] into an [`Input::Live`],
    /// placing blocking I/O on a tokio blocking thread.
    pub async fn make_playable_async(
        self,
        codecs: &'static CodecRegistry,
        probe: &'static Probe,
    ) -> Result<Self, MakePlayableError> {
        let out = self.make_live_async().await?;
        match out {
            Self::Lazy(_) => unreachable!(),
            Self::Live(input, lazy) => {
                let promoted = tokio::task::spawn_blocking(move || input.promote(codecs, probe))
                    .await
                    .map_err(|_| MakePlayableError::Panicked)??;
                Ok(Self::Live(promoted, lazy))
            },
        }
    }

    /// Returns whether this audio stream is full initialised, parsed, and
    /// ready to play (e.g., `Self::Live(LiveInput::Parsed(p), _)`).
    #[must_use]
    pub fn is_playable(&self) -> bool {
        if let Self::Live(input, _) = self {
            input.is_playable()
        } else {
            false
        }
    }

    /// Returns a reference to the live input, if it has been created via
    /// [`Self::make_live`] or [`Self::make_live_async`].
    #[must_use]
    pub fn live(&self) -> Option<&LiveInput> {
        if let Self::Live(input, _) = self {
            Some(input)
        } else {
            None
        }
    }

    /// Returns a mutable reference to the live input, if it been created via
    /// [`Self::make_live`] or [`Self::make_live_async`].
    pub fn live_mut(&mut self) -> Option<&mut LiveInput> {
        if let Self::Live(ref mut input, _) = self {
            Some(input)
        } else {
            None
        }
    }

    /// Returns a reference to the data parsed from this input stream, if it has
    /// been made available via [`Self::make_playable`] or [`LiveInput::promote`].
    #[must_use]
    pub fn parsed(&self) -> Option<&Parsed> {
        self.live().and_then(LiveInput::parsed)
    }

    /// Returns a mutable reference to the data parsed from this input stream, if it
    /// has been made available via [`Self::make_playable`] or [`LiveInput::promote`].
    pub fn parsed_mut(&mut self) -> Option<&mut Parsed> {
        self.live_mut().and_then(LiveInput::parsed_mut)
    }
}

impl<T: AsRef<[u8]> + Send + Sync + 'static> From<T> for Input {
    fn from(val: T) -> Self {
        let raw_src = LiveInput::Raw(AudioStream {
            input: Box::new(Cursor::new(val)),
        });

        Input::Live(raw_src, None)
    }
}
