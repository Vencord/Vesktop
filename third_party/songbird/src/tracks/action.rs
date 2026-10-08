use flume::Sender;
use std::time::Duration;

use super::{PlayError, SeekRequest};

/// Actions for the mixer to take after inspecting track state via
/// [`TrackHandle::action`].
///
/// [`TrackHandle::action`]: super::TrackHandle::action
#[derive(Clone, Default)]
pub struct Action {
    pub(crate) make_playable: Option<Sender<Result<(), PlayError>>>,
    pub(crate) seek_point: Option<SeekRequest>,
}

impl Action {
    /// Requests a seek to the given time for this track.
    #[must_use]
    pub fn seek(mut self, time: Duration) -> Self {
        let (callback, _) = flume::bounded(1);
        self.seek_point = Some(SeekRequest { time, callback });

        self
    }

    /// Readies the track to be playable, if this is not already the case.
    #[must_use]
    pub fn make_playable(mut self) -> Self {
        let (tx, _) = flume::bounded(1);
        self.make_playable = Some(tx);

        self
    }

    pub(crate) fn combine(&mut self, other: Self) {
        if other.make_playable.is_some() {
            self.make_playable = other.make_playable;
        }
        if other.seek_point.is_some() {
            self.seek_point = other.seek_point;
        }
    }
}
