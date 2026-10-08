//! Utility methods for seeking or decoding.

use crate::constants::*;
use opus2::{Channels, Decoder, Result as OpusResult};
use std::{mem, time::Duration};

/// Calculates the sample position in a `FloatPCM` stream from a timestamp.
#[must_use]
pub fn timestamp_to_sample_count(timestamp: Duration, stereo: bool) -> usize {
    ((timestamp.as_millis() as usize) * (MONO_FRAME_SIZE / FRAME_LEN_MS)) << stereo as usize
}

/// Calculates the time position in a `FloatPCM` stream from a sample index.
#[must_use]
pub fn sample_count_to_timestamp(amt: usize, stereo: bool) -> Duration {
    Duration::from_millis((((amt * FRAME_LEN_MS) / MONO_FRAME_SIZE) as u64) >> stereo as u64)
}

/// Calculates the byte position in a `FloatPCM` stream from a timestamp.
///
/// Each sample is sized by `mem::size_of::<f32>() == 4usize`.
#[must_use]
pub fn timestamp_to_byte_count(timestamp: Duration, stereo: bool) -> usize {
    timestamp_to_sample_count(timestamp, stereo) * mem::size_of::<f32>()
}

/// Calculates the time position in a `FloatPCM` stream from a byte index.
///
/// Each sample is sized by `mem::size_of::<f32>() == 4usize`.
#[must_use]
pub fn byte_count_to_timestamp(amt: usize, stereo: bool) -> Duration {
    sample_count_to_timestamp(amt / mem::size_of::<f32>(), stereo)
}

/// Create an Opus decoder outputting at a sample rate of 48kHz.
pub fn decoder(stereo: bool) -> OpusResult<Decoder> {
    Decoder::new(
        48000,
        if stereo {
            Channels::Stereo
        } else {
            Channels::Mono
        },
    )
}
