use super::*;
use crate::input::Metadata;

/// Live track and input state exposed during [`TrackHandle::action`].
///
/// [`TrackHandle::action`]: super::[`TrackHandle::action`]
#[non_exhaustive]
pub struct View<'a> {
    /// The current position within this track.
    pub position: &'a Duration,

    /// The total time a track has been played for.
    pub play_time: &'a Duration,

    /// The current mixing volume of this track.
    pub volume: &'a mut f32,

    /// In-stream metadata for this track, if it is fully readied.
    pub meta: Option<Metadata<'a>>,

    /// The current play status of this track.
    pub playing: &'a mut PlayMode,

    /// Whether this track has been made live, is being processed, or is
    /// currently uninitialised.
    pub ready: ReadyState,

    /// The number of remaning loops on this track.
    pub loops: &'a mut LoopState,
}
