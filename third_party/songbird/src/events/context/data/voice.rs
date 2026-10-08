use std::collections::{HashMap, HashSet};

use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
/// Audio data from all users in a voice channel, fired every 20ms.
///
/// Songbird implements a jitter buffer to sycnhronise user packets, smooth out network latency, and
/// handle packet reordering by the network. Packet playout  via this event is delayed by approximately
/// [`Config::playout_buffer_length`]` * 20ms` from its original arrival.
///
/// [`Config::playout_buffer_length`]: crate::Config::playout_buffer_length
pub struct VoiceTick {
    /// Decoded voice data and source packets sent by each user.
    pub speaking: HashMap<u32, VoiceData>,

    /// Set of all SSRCs currently known in the call who aren't included in [`Self::speaking`].
    pub silent: HashSet<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
/// Voice packet and audio data for a single user, from a single tick.
pub struct VoiceData {
    /// RTP packet clocked out for this tick.
    ///
    /// If `None`, then the packet was lost, and [`Self::decoded_voice`] may include
    /// around one codec delay's worth of audio.
    pub packet: Option<RtpData>,
    /// PCM audio obtained from a user.
    ///
    /// Valid audio data (`Some(audio)` where `audio.len >= 0`) typically contains 20ms of 16-bit PCM audio
    /// using native endianness. This defaults to stereo audio at 48kHz, and can be configured via
    /// [`DecodeConfig::sample_rate`] and [`DecodeConfig::sample_rate`] -- channels are interleaved
    /// (i.e., `L, R, L, R, ...`) if stereo.
    ///
    /// This value will be `None` if Songbird is not configured to decode audio.
    ///
    /// [`DecodeConfig::decode_channels`]: crate::driver::DecodeConfig::channels
    /// [`DecodeConfig::sample_rate`]: crate::driver::DecodeConfig::sample_rate
    pub decoded_voice: Option<Vec<i16>>,
}
