use super::{default_config, raw_cost_per_sec, Error};
use crate::input::{AudioStream, Input, LiveInput};
use std::io::{Read, Result as IoResult, Seek};
use streamcatcher::{Catcher, Config};
use symphonia_core::io::MediaSource;

/// A wrapper around an existing [`Input`] which caches its data
/// in memory.
///
/// The main purpose of this wrapper is to enable fast seeking on
/// incompatible sources (i.e., HTTP streams) and to ease resource
/// consumption for commonly reused/shared tracks.
///
/// This consumes exactly as many bytes of memory as the input stream contains.
///
/// [`Input`]: Input
#[derive(Clone)]
pub struct Memory {
    /// Inner shared bytestore.
    pub raw: Catcher<Box<dyn MediaSource>>,
}

impl Memory {
    /// Wrap an existing [`Input`] with an in-memory store with the same codec and framing.
    ///
    /// [`Input`]: Input
    pub async fn new(source: Input) -> Result<Self, Error> {
        Self::with_config(source, None).await
    }

    /// Wrap an existing [`Input`] with an in-memory store with the same codec and framing.
    ///
    /// `length_hint` may be used to control the size of the initial chunk, preventing
    /// needless allocations and copies.
    ///
    /// [`Input`]: Input
    pub async fn with_config(source: Input, config: Option<Config>) -> Result<Self, Error> {
        let input = match source {
            Input::Lazy(mut r) => {
                let created = if r.should_create_async() {
                    r.create_async().await
                } else {
                    tokio::task::spawn_blocking(move || r.create()).await?
                };

                created.map(|v| v.input).map_err(Error::from)
            },
            Input::Live(LiveInput::Raw(a), _rec) => Ok(a.input),
            Input::Live(LiveInput::Wrapped(a), _rec) =>
                Ok(Box::new(a.input) as Box<dyn MediaSource>),
            Input::Live(LiveInput::Parsed(_), _) => Err(Error::StreamNotAtStart),
        }?;

        let cost_per_sec = raw_cost_per_sec(true);

        let config = config.unwrap_or_else(|| default_config(cost_per_sec));

        // TODO: apply length hint.
        // if config.length_hint.is_none() {
        //     if let Some(dur) = metadata.duration {
        //         apply_length_hint(&mut config, dur, cost_per_sec);
        //     }
        // }

        let raw = config.build(input)?;

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

impl Read for Memory {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        self.raw.read(buf)
    }
}

impl Seek for Memory {
    fn seek(&mut self, pos: std::io::SeekFrom) -> IoResult<u64> {
        self.raw.seek(pos)
    }
}

impl MediaSource for Memory {
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

impl From<Memory> for Input {
    fn from(val: Memory) -> Input {
        let input = Box::new(val);
        Input::Live(LiveInput::Raw(AudioStream { input }), None)
    }
}
