// TODO: Could this be a bitset? Could accelerate lookups,
// allow easy joint subscription & remove Vecs for related evt handling?

/// Track events correspond to certain actions or changes
/// of state, such as a track finishing, looping, or being
/// manually stopped. Voice core events occur on receipt of
/// voice packets and telemetry.
///
/// Track events persist while the `action` in [`EventData`]
/// returns `None`.
///
/// [`EventData`]: super::EventData
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, enum_map::Enum)]
#[non_exhaustive]
pub enum TrackEvent {
    /// The attached track has resumed playing.
    ///
    /// This event will not fire when a track first starts,
    /// but will fire when a track changes from, e.g., paused to playing.
    /// This is most relevant for queue users: queued tracks placed into a
    /// non-empty queue are initlally paused, and are later moved to `Play`.
    Play,
    /// The attached track has been paused.
    Pause,
    /// The attached track has ended.
    End,
    /// The attached track has looped.
    Loop,
    /// The attached track is being readied or recreated.
    Preparing,
    /// The attached track has become playable.
    Playable,
    /// The attached track has encountered a runtime or initialisation error.
    Error,
}
