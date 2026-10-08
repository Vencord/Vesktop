#![allow(missing_docs)]

use crate::{
    events::{CoreContext, EventData, EventStore},
    tracks::{LoopState, PlayMode, ReadyState, TrackHandle, TrackState},
};
use std::time::Duration;

pub enum EventMessage {
    // Event related.
    // Track events should fire off the back of state changes.
    AddGlobalEvent(EventData),
    AddTrackEvent(usize, EventData),
    FireCoreEvent(CoreContext),
    RemoveGlobalEvents,

    AddTrack(EventStore, TrackState, TrackHandle),
    ChangeState(usize, TrackStateChange),
    RemoveAllTracks,
    Tick,

    Poison,
}

#[derive(Debug)]
pub enum TrackStateChange {
    Mode(PlayMode),
    Volume(f32),
    Position(Duration),
    // Bool indicates user-set.
    Loops(LoopState, bool),
    Total(TrackState),
    Ready(ReadyState),
}
