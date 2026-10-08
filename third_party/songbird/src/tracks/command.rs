use super::*;
use crate::events::EventData;
use flume::Sender;
use std::fmt::{Debug, Formatter, Result as FmtResult};

/// A request from external code using a [`TrackHandle`] to modify
/// or act upon an [`Track`] object.
///
/// [`Track`]: Track
/// [`TrackHandle`]: TrackHandle
#[non_exhaustive]
pub enum TrackCommand {
    /// Set the track's play_mode to play/resume.
    Play,
    /// Set the track's play_mode to pause.
    Pause,
    /// Stop the target track. This cannot be undone.
    Stop,
    /// Set the track's volume.
    Volume(f32),
    /// Seek to the given duration.
    ///
    /// On unsupported input types, this can be fatal.
    Seek(SeekRequest),
    /// Register an event on this track.
    AddEvent(EventData),
    /// Run some closure on this track, with direct access to the core object.
    Do(Box<dyn FnOnce(View<'_>) -> Option<Action> + Send + Sync + 'static>),
    /// Request a copy of this track's state.
    Request(Sender<TrackState>),
    /// Change the loop count/strategy of this track.
    Loop(LoopState),
    /// Prompts a track's input to become live and usable, if it is not already.
    MakePlayable(Sender<Result<(), PlayError>>),
}

impl Debug for TrackCommand {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(
            f,
            "TrackCommand::{}",
            match self {
                Self::Play => "Play".to_string(),
                Self::Pause => "Pause".to_string(),
                Self::Stop => "Stop".to_string(),
                Self::Volume(vol) => format!("Volume({vol})"),
                Self::Seek(s) => format!("Seek({:?})", s.time),
                Self::AddEvent(evt) => format!("AddEvent({evt:?})"),
                Self::Do(_f) => "Do([function])".to_string(),
                Self::Request(tx) => format!("Request({tx:?})"),
                Self::Loop(loops) => format!("Loop({loops:?})"),
                Self::MakePlayable(_) => "MakePlayable".to_string(),
            }
        )
    }
}

#[derive(Clone, Debug)]
pub struct SeekRequest {
    pub time: Duration,
    pub callback: Sender<Result<Duration, PlayError>>,
}
