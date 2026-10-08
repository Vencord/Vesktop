//! In-memory, shared input sources for reuse between calls, fast seeking, and
//! direct Opus frame passthrough.

mod compressed;
mod decompressed;
mod error;
mod hint;
mod memory;
mod util;

pub(crate) use self::util::*;
pub use self::{compressed::*, decompressed::*, error::*, hint::*, memory::*};

use crate::constants::*;
use crate::input::utils;
use opus2::Bitrate;
use std::{mem, time::Duration};
use streamcatcher::{Config as ScConfig, GrowthStrategy};

/// Estimates the cost, in B/s, of audio data compressed at the given bitrate.
#[must_use]
pub fn compressed_cost_per_sec(bitrate: Bitrate) -> usize {
    let framing_cost_per_sec = AUDIO_FRAME_RATE * mem::size_of::<u16>();

    let bitrate_raw = match bitrate {
        Bitrate::Bits(i) => i,
        Bitrate::Auto => 64_000,
        Bitrate::Max => 512_000,
    } as usize;

    (bitrate_raw / 8) + framing_cost_per_sec
}

/// Calculates the cost, in B/s, of raw floating-point audio data.
#[must_use]
pub fn raw_cost_per_sec(stereo: bool) -> usize {
    utils::timestamp_to_byte_count(Duration::from_secs(1), stereo)
}

/// Provides the default config used by a cached source.
///
/// This maps to the default configuration in [`streamcatcher`], using
/// a constant chunk size of 5s worth of audio at the given bitrate estimate.
///
/// [`streamcatcher`]: https://docs.rs/streamcatcher/0.1.0/streamcatcher/struct.Config.html
#[must_use]
pub fn default_config(cost_per_sec: usize) -> ScConfig {
    ScConfig::new().chunk_size(GrowthStrategy::Constant(5 * cost_per_sec))
}
