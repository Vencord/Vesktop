use super::{compressed::Config, CodecCacheError, ToAudioBytes};
use crate::{
    constants::SAMPLE_RATE_RAW,
    input::{AudioStream, Input, LiveInput, RawAdapter},
};
use std::io::{Read, Result as IoResult, Seek, SeekFrom};
use streamcatcher::Catcher;
use symphonia_core::{audio::Channels, io::MediaSource};

/// A wrapper around an existing [`Input`] which caches
/// the decoded and converted audio data locally in memory
/// as `f32`-format PCM data.
///
/// The main purpose of this wrapper is to enable seeking on
/// incompatible sources (i.e., ffmpeg output) and to ease resource
/// consumption for commonly reused/shared tracks. [`Compressed`]
/// offers similar functionality with different
/// tradeoffs.
///
/// This is intended for use with small, repeatedly used audio
/// tracks shared between sources, and stores the sound data
/// retrieved in **uncompressed floating point** form to minimise the
/// cost of audio processing when mixing several tracks together.
/// This must be used sparingly: these cost a significant
/// *3 Mbps (375 kiB/s)*, or 131 MiB of RAM for a 6 minute song.
///
/// [`Input`]: crate::input::Input
/// [`Compressed`]: super::Compressed
#[derive(Clone)]
pub struct Decompressed {
    /// Inner shared bytestore.
    pub raw: Catcher<RawAdapter<ToAudioBytes>>,
}

impl Decompressed {
    /// Wrap an existing [`Input`] with an in-memory store, decompressed into `f32` PCM audio.
    ///
    /// [`Input`]: Input
    pub async fn new(source: Input) -> Result<Self, CodecCacheError> {
        Self::with_config(source, None).await
    }

    /// Wrap an existing [`Input`] with an in-memory store, decompressed into `f32` PCM audio,
    /// with custom configuration for both Symphonia and the backing store.
    ///
    /// [`Input`]: Input
    pub async fn with_config(
        source: Input,
        config: Option<Config>,
    ) -> Result<Self, CodecCacheError> {
        let input = match source {
            Input::Lazy(mut r) => {
                let created = if r.should_create_async() {
                    r.create_async().await.map_err(CodecCacheError::from)
                } else {
                    tokio::task::spawn_blocking(move || r.create().map_err(CodecCacheError::from))
                        .await
                        .map_err(CodecCacheError::from)
                        .and_then(|v| v)
                };

                created.map(LiveInput::Raw)
            },
            Input::Live(LiveInput::Parsed(_), _) => Err(CodecCacheError::StreamNotAtStart),
            Input::Live(a, _rec) => Ok(a),
        }?;

        let cost_per_sec = super::raw_cost_per_sec(true);
        let config = config.unwrap_or_else(|| Config::default_from_cost(cost_per_sec));

        let promoted = tokio::task::spawn_blocking(move || {
            input.promote(config.codec_registry, config.format_registry)
        })
        .await??;

        // If success, guaranteed to be Parsed
        let LiveInput::Parsed(parsed) = promoted else {
            unreachable!()
        };

        let track_info = parsed.decoder.codec_params();
        let chan_count = track_info
            .channels
            .map(Channels::count)
            .ok_or(CodecCacheError::UnknownChannelCount)?;
        let sample_rate = SAMPLE_RATE_RAW as u32;

        let source = RawAdapter::new(
            ToAudioBytes::new(parsed, Some(chan_count)),
            sample_rate,
            chan_count as u32,
        );

        let raw = config.streamcatcher.build(source)?;

        Ok(Self { raw })
    }

    /// Acquire a new handle to this object, creating a new
    /// view of the existing cached data from the beginning.
    #[must_use]
    pub fn new_handle(&self) -> Self {
        Self {
            raw: self.raw.new_handle(),
        }
    }
}

impl Read for Decompressed {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        self.raw.read(buf)
    }
}

impl Seek for Decompressed {
    fn seek(&mut self, pos: SeekFrom) -> IoResult<u64> {
        self.raw.seek(pos)
    }
}

impl MediaSource for Decompressed {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        if self.raw.is_finished() {
            Some(self.raw.len() as u64)
        } else {
            None
        }
    }
}

impl From<Decompressed> for Input {
    fn from(val: Decompressed) -> Input {
        let input = Box::new(val);
        Input::Live(LiveInput::Raw(AudioStream { input }), None)
    }
}
