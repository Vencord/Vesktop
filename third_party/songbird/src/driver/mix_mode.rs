use opus2::Channels;
use symphonia_core::audio::Layout;

use crate::constants::{MONO_FRAME_SIZE, STEREO_FRAME_SIZE};

/// Mixing behaviour for sent audio sources processed within the driver.
///
/// This has no impact on Opus packet passthrough, which will pass packets
/// irrespective of their channel count.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixMode {
    /// Audio sources will be downmixed into a mono buffer.
    Mono,
    /// Audio sources will be mixed into into a stereo buffer, where mono sources
    /// will be duplicated into both channels.
    Stereo,
}

impl MixMode {
    pub(crate) const fn to_opus(self) -> Channels {
        match self {
            Self::Mono => Channels::Mono,
            Self::Stereo => Channels::Stereo,
        }
    }

    pub(crate) const fn sample_count_in_frame(self) -> usize {
        match self {
            Self::Mono => MONO_FRAME_SIZE,
            Self::Stereo => STEREO_FRAME_SIZE,
        }
    }

    pub(crate) const fn channels(self) -> usize {
        match self {
            Self::Mono => 1,
            Self::Stereo => 2,
        }
    }

    pub(crate) const fn symph_layout(self) -> Layout {
        match self {
            Self::Mono => Layout::Mono,
            Self::Stereo => Layout::Stereo,
        }
    }
}

impl From<MixMode> for Layout {
    fn from(val: MixMode) -> Self {
        val.symph_layout()
    }
}

impl From<MixMode> for Channels {
    fn from(val: MixMode) -> Self {
        val.to_opus()
    }
}
