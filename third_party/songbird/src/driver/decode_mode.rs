use opus2::Channels as OpusChannels;

/// Decode behaviour for received RTP packets within the driver.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum DecodeMode {
    /// Packets received from Discord are handed over to events without any
    /// changes applied.
    ///
    /// No CPU work involved.
    Pass,
    /// Decrypts the body of each received packet.
    ///
    /// Small per-packet CPU use.
    Decrypt,
    /// Decrypts and decodes each received packet, correctly accounting for losses.
    ///
    /// Larger per-packet CPU use.
    Decode(DecodeConfig),
}

impl DecodeMode {
    /// Returns whether this mode will decrypt and decode received packets.
    #[must_use]
    pub fn should_decode(self) -> bool {
        matches!(self, DecodeMode::Decode(..))
    }

    /// Returns whether this mode will decrypt received packets.
    #[must_use]
    pub fn should_decrypt(self) -> bool {
        self != DecodeMode::Pass
    }
}

/// Configuration for [`DecodeMode::Decode`]
#[non_exhaustive]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash)]
pub struct DecodeConfig {
    /// Configures the channel layout for output audio.
    ///
    /// Defaults to [`Channels::Stereo`].
    pub channels: Channels,

    /// Configures the sample rate for output audio.
    ///
    /// Defaults to [`SampleRate::Hz48000`].
    pub sample_rate: SampleRate,
}

impl DecodeConfig {
    /// Creates a new [`DecodeConfig`] with the specified channels and sample rate.
    #[must_use]
    pub fn new(channels: Channels, sample_rate: SampleRate) -> Self {
        Self {
            channels,
            sample_rate,
        }
    }
}

/// The channel layout of output audio when using [`DecodeMode::Decode`].
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum Channels {
    /// Decode received audio packets into a single channel.
    Mono,
    /// Decode received audio packets into two interleaved channels.
    ///
    /// Received mono packets' samples will automatically be duplicated across
    /// both channels.
    ///
    /// The default choice.
    #[default]
    Stereo,
}

impl Channels {
    pub(crate) fn channels(self) -> usize {
        match self {
            Channels::Mono => 1,
            Channels::Stereo => 2,
        }
    }
}

impl From<Channels> for OpusChannels {
    fn from(value: Channels) -> Self {
        match value {
            Channels::Mono => OpusChannels::Mono,
            Channels::Stereo => OpusChannels::Stereo,
        }
    }
}

/// The sample rate of output audio when using [`DecodeMode::Decode`].
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum SampleRate {
    /// Decode to a sample rate of 8kHz.
    Hz8000,
    /// Decode to a sample rate of 12kHz.
    Hz12000,
    /// Decode to a sample rate of 16kHz.
    Hz16000,
    /// Decode to a sample rate of 24kHz.
    Hz24000,
    /// Decode to a sample rate of 48kHz.
    ///
    /// The preferred option for encoding/decoding at or above CD quality.
    #[default]
    Hz48000,
}

impl From<SampleRate> for u32 {
    fn from(value: SampleRate) -> Self {
        match value {
            SampleRate::Hz8000 => 8000,
            SampleRate::Hz12000 => 12000,
            SampleRate::Hz16000 => 16000,
            SampleRate::Hz24000 => 24000,
            SampleRate::Hz48000 => 48000,
        }
    }
}
