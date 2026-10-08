//! Constants affecting driver function and API handling.

#[cfg(feature = "driver")]
use discortp::rtp::RtpType;
#[cfg(feature = "driver")]
use opus2::Bitrate;
use std::time::Duration;

#[cfg(feature = "driver")]
/// The voice gateway version used by the library.
pub const VOICE_GATEWAY_VERSION: u8 = crate::model::constants::GATEWAY_VERSION;

#[cfg(feature = "driver")]
/// Sample rate of audio to be sent to Discord.
pub const SAMPLE_RATE: u32 = 48000;

/// Sample rate of audio to be sent to Discord.
pub const SAMPLE_RATE_RAW: usize = 48_000;

/// Number of audio frames/packets to be sent per second.
pub const AUDIO_FRAME_RATE: usize = 50;

/// Length of time between any two audio frames.
pub const TIMESTEP_LENGTH: Duration = Duration::from_millis(1000 / AUDIO_FRAME_RATE as u64);

#[cfg(feature = "driver")]
/// Default bitrate for audio.
pub const DEFAULT_BITRATE: Bitrate = Bitrate::Bits(128_000);

/// Number of output samples at 48kHZ to produced when resampling subframes.
pub(crate) const RESAMPLE_OUTPUT_FRAME_SIZE: usize = MONO_FRAME_SIZE / 2;

/// The maximum number of bad frames to allow in an Opus source before blocking passthrough.
pub(crate) const OPUS_PASSTHROUGH_STRIKE_LIMIT: u8 = 3;

/// Number of samples in one complete frame of audio per channel.
///
/// This is equally the number of stereo (joint) samples in an audio frame.
pub const MONO_FRAME_SIZE: usize = SAMPLE_RATE_RAW / AUDIO_FRAME_RATE;

/// Number of individual samples in one complete frame of stereo audio.
pub const STEREO_FRAME_SIZE: usize = 2 * MONO_FRAME_SIZE;

/// Number of bytes in one complete frame of raw `f32`-encoded mono audio.
pub const MONO_FRAME_BYTE_SIZE: usize = MONO_FRAME_SIZE * std::mem::size_of::<f32>();

/// Number of bytes in one complete frame of raw `f32`-encoded stereo audio.
pub const STEREO_FRAME_BYTE_SIZE: usize = STEREO_FRAME_SIZE * std::mem::size_of::<f32>();

/// Length (in milliseconds) of any audio frame.
pub const FRAME_LEN_MS: usize = 1000 / AUDIO_FRAME_RATE;

/// Maximum number of audio frames/packets to be sent per second to be buffered.
pub const CHILD_BUFFER_LEN: usize = AUDIO_FRAME_RATE / 2;

/// Maximum packet size for a voice packet.
///
/// Set a safe amount below the Ethernet MTU to avoid fragmentation/rejection.
pub const VOICE_PACKET_MAX: usize = 1460;

/// Delay between sends of UDP keepalive frames.
///
/// Passive monitoring of Discord itself shows that these fire every 5 seconds
/// irrespective of outgoing UDP traffic.
pub const UDP_KEEPALIVE_GAP_MS: u64 = 5_000;

/// Type-converted delay between sends of UDP keepalive frames.
///
/// Passive monitoring of Discord itself shows that these fire every 5 seconds
/// irrespective of outgoing UDP traffic.
pub const UDP_KEEPALIVE_GAP: Duration = Duration::from_millis(UDP_KEEPALIVE_GAP_MS);

/// Opus silent frame, used to signal speech start and end (and prevent audio glitching).
pub const SILENT_FRAME: [u8; 3] = [0xf8, 0xff, 0xfe];

/// The one (and only) RTP version.
pub const RTP_VERSION: u8 = 2;

#[cfg(feature = "driver")]
/// Profile type used by Discord's Opus audio traffic.
pub const RTP_PROFILE_TYPE: RtpType = RtpType::Dynamic(120);

#[cfg(feature = "receive")]
/// The magic marker appended to the end of DAVE encrypted payloads, used to determine
/// whether the voice packet is encrypted.
pub const DAVE_MAGIC_MARKER: [u8; 2] = [0xfa, 0xfa];

#[cfg(test)]
#[allow(clippy::doc_markdown, missing_docs)]
pub mod test_data {
    /// URL for a source which YTDL must extract.
    ///
    /// Referenced under CC BY-NC-SA 3.0 -- https://creativecommons.org/licenses/by-nc-sa/3.0/
    pub const YTDL_TARGET: &str = "https://cloudkicker.bandcamp.com/track/94-days";

    /// URL for a source that has both a playlist and a music video,
    /// which YTDL should extract.
    ///
    /// Referenced under CC BY-NC-SA 3.0 -- https://creativecommons.org/licenses/by-nc-sa/3.0/
    pub const YTDL_PLAYLIST_TARGET: &str =
        "https://www.youtube.com/watch?v=KSgEFfWZ-W0&list=OLAK5uy_l2x81ffbpevMSjUn7NniL_rNLulWM3n6g&index=7";

    /// URL for a source which can be read via an Http Request.
    ///
    /// Referenced under CC BY-NC-SA 3.0 -- https://creativecommons.org/licenses/by-nc-sa/3.0/
    pub const HTTP_TARGET: &str = "https://github.com/FelixMcFelix/songbird/raw/symphonia/resources/Cloudkicker%20-%202011%2007.mp3";

    /// URL for an opus/ogg source which can be read via an Http Request.
    ///
    /// Referenced under CC BY 3.0 -- https://creativecommons.org/licenses/by/3.0/
    pub const HTTP_OPUS_TARGET: &str = "https://github.com/FelixMcFelix/songbird/raw/symphonia/resources/Cloudkicker%20-%20Making%20Will%20Mad.opus";

    /// URL for an opus/webm source which can be read via an Http Request.
    ///
    /// Referenced under CC BY 3.0 -- https://creativecommons.org/licenses/by/3.0/
    pub const HTTP_WEBM_TARGET: &str = "https://github.com/FelixMcFelix/songbird/raw/symphonia/resources/Cloudkicker%20-%20Making%20Will%20Mad.webm";

    /// Path to a DCA source.
    ///
    /// Referenced under CC BY-NC-SA 3.0 -- https://creativecommons.org/licenses/by-nc-sa/3.0/
    pub const FILE_DCA_TARGET: &str = "resources/Cloudkicker - 2011 07.dca1";

    /// Path to an opus source which can be read via a File.
    ///
    /// Referenced under CC BY 3.0 -- https://creativecommons.org/licenses/by/3.0/
    pub const FILE_WEBM_TARGET: &str = "resources/Cloudkicker - Making Will Mad.webm";

    /// Path to a Wav source which can be read via a File.
    pub const FILE_WAV_TARGET: &str = "resources/loop.wav";

    /// Path to a shorter MP3 source which can be read via a File.
    pub const FILE_SHORT_MP3_TARGET: &str = "resources/ting.mp3";

    /// Path to an MP4 (H264 + AAC) source which can be read via a File.
    pub const FILE_VID_TARGET: &str = "resources/ting-vid.mp4";
}
