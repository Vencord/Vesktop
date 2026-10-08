use super::*;

/// Track and voice core events.
///
/// Untimed events persist while the `action` in [`EventData`]
/// returns `None`.
///
/// [`EventData`]: EventData
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, enum_map::Enum)]
#[non_exhaustive]
pub enum UntimedEvent {
    /// Untimed events belonging to a track, such as state changes, end, or loops.
    Track(TrackEvent),
    /// Untimed events belonging to the global context, such as finished tracks,
    /// client speaking updates, or RT(C)P voice and telemetry data.
    Core(CoreEvent),
}

impl From<TrackEvent> for UntimedEvent {
    fn from(evt: TrackEvent) -> Self {
        UntimedEvent::Track(evt)
    }
}

impl From<CoreEvent> for UntimedEvent {
    fn from(evt: CoreEvent) -> Self {
        UntimedEvent::Core(evt)
    }
}
