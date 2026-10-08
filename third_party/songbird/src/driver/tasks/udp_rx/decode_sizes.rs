use crate::constants::STEREO_FRAME_SIZE;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PacketDecodeSize {
    /// Minimum frame size on Discord.
    TwentyMillis,
    /// Hybrid packet, sent by Firefox web client.
    ///
    /// Likely 20ms frame + 10ms frame.
    ThirtyMillis,
    /// Next largest frame size.
    FortyMillis,
    /// Maximum Opus frame size.
    SixtyMillis,
    /// Maximum Opus packet size: 120ms.
    Max,
}

impl PacketDecodeSize {
    pub fn bump_up(self) -> Self {
        match self {
            Self::TwentyMillis => Self::ThirtyMillis,
            Self::ThirtyMillis => Self::FortyMillis,
            Self::FortyMillis => Self::SixtyMillis,
            Self::SixtyMillis | Self::Max => Self::Max,
        }
    }

    pub fn can_bump_up(self) -> bool {
        self != Self::Max
    }

    pub fn len(self) -> usize {
        match self {
            Self::TwentyMillis => STEREO_FRAME_SIZE,
            Self::ThirtyMillis => (STEREO_FRAME_SIZE / 2) * 3,
            Self::FortyMillis => 2 * STEREO_FRAME_SIZE,
            Self::SixtyMillis => 3 * STEREO_FRAME_SIZE,
            Self::Max => 6 * STEREO_FRAME_SIZE,
        }
    }
}
