use super::*;
use crate::events::{Event, EventData, EventHandler};
use flume::{Receiver, Sender};
use nonmax::NonMaxU32;
use std::{any::Any, sync::Arc, time::Duration};
use uuid::Uuid;

#[derive(Clone, Debug)]
/// Handle for safe control of a [`Track`] from other threads, outside
/// of the audio mixing and voice handling context.
///
/// These are cheap to clone, using `Arc<...>` internally.
///
/// Many method calls here are fallible; in most cases, this will be because
/// the underlying [`Track`] object has been discarded. Those which aren't refer
/// to shared data not used by the driver.
pub struct TrackHandle {
    inner: Arc<InnerHandle>,
}

#[derive(Debug)]
struct InnerHandle {
    command_channel: Sender<TrackCommand>,
    uuid: Uuid,
    data: Arc<dyn Any + Send + Sync + 'static>,
}

impl TrackHandle {
    /// Creates a new handle, using the given command sink.
    ///
    /// [`Input`]: crate::input::Input
    #[must_use]
    pub(crate) fn new(
        command_channel: Sender<TrackCommand>,
        uuid: Uuid,
        data: Arc<dyn Any + Send + Sync + 'static>,
    ) -> Self {
        let inner = Arc::new(InnerHandle {
            command_channel,
            uuid,
            data,
        });

        Self { inner }
    }

    /// Unpauses an audio track.
    pub fn play(&self) -> TrackResult<()> {
        self.send(TrackCommand::Play)
    }

    /// Pauses an audio track.
    pub fn pause(&self) -> TrackResult<()> {
        self.send(TrackCommand::Pause)
    }

    /// Stops an audio track.
    ///
    /// This is *final*, and will cause the audio context to fire
    /// a [`TrackEvent::End`] event.
    ///
    /// [`TrackEvent::End`]: crate::events::TrackEvent::End
    pub fn stop(&self) -> TrackResult<()> {
        self.send(TrackCommand::Stop)
    }

    /// Sets the volume of an audio track.
    pub fn set_volume(&self, volume: f32) -> TrackResult<()> {
        self.send(TrackCommand::Volume(volume))
    }

    #[must_use]
    /// Ready a track for playing if it is lazily initialised.
    ///
    /// If a track is already playable, the callback will instantly succeed.
    pub fn make_playable(&self) -> TrackCallback<()> {
        let (tx, rx) = flume::bounded(1);
        let fail = self.send(TrackCommand::MakePlayable(tx)).is_err();

        TrackCallback { fail, rx }
    }

    /// Ready a track for playing if it is lazily initialised.
    ///
    /// This folds [`Self::make_playable`] into a single `async` result, but must
    /// be awaited for the command to be sent.
    pub async fn make_playable_async(&self) -> TrackResult<()> {
        self.make_playable().result_async().await
    }

    #[must_use]
    /// Seeks along the track to the specified position.
    ///
    /// If the underlying [`Input`] does not support seeking,
    /// forward seeks will succeed. Backward seeks will recreate the
    /// track using the lazy [`Compose`] if present. The returned callback
    /// will indicate whether the seek succeeded.
    ///
    /// [`Input`]: crate::input::Input
    /// [`Compose`]: crate::input::Compose
    pub fn seek(&self, position: Duration) -> TrackCallback<Duration> {
        let (tx, rx) = flume::bounded(1);
        let fail = self
            .send(TrackCommand::Seek(SeekRequest {
                time: position,
                callback: tx,
            }))
            .is_err();

        TrackCallback { fail, rx }
    }

    /// Seeks along the track to the specified position.
    ///
    /// This folds [`Self::seek`] into a single `async` result, but must
    /// be awaited for the command to be sent.
    pub async fn seek_async(&self, position: Duration) -> TrackResult<Duration> {
        self.seek(position).result_async().await
    }

    /// Attach an event handler to an audio track. These will receive [`EventContext::Track`].
    ///
    /// Events which can only be fired by the global context return [`ControlError::InvalidTrackEvent`]
    ///
    /// [`EventContext::Track`]: crate::events::EventContext::Track
    pub fn add_event<F: EventHandler + 'static>(&self, event: Event, action: F) -> TrackResult<()> {
        let cmd = TrackCommand::AddEvent(EventData::new(event, action));
        if event.is_global_only() {
            Err(ControlError::InvalidTrackEvent)
        } else {
            self.send(cmd)
        }
    }

    /// Perform an arbitrary synchronous action on a raw [`Track`] object.
    ///
    /// This will give access to a [`View`] of the current track state and [`Metadata`],
    /// which can be used to take an [`Action`].
    ///
    /// Users **must** ensure that no costly work or blocking occurs
    /// within the supplied function or closure. *Taking excess time could prevent
    /// timely sending of packets, causing audio glitches and delays*.
    ///
    /// [`Metadata`]: crate::input::Metadata
    pub fn action<F>(&self, action: F) -> TrackResult<()>
    where
        F: FnOnce(View<'_>) -> Option<Action> + Send + Sync + 'static,
    {
        self.send(TrackCommand::Do(Box::new(action)))
    }

    /// Request playback information and state from the audio context.
    pub async fn get_info(&self) -> TrackResult<TrackState> {
        let (tx, rx) = flume::bounded(1);
        self.send(TrackCommand::Request(tx))?;

        rx.recv_async().await.map_err(|_| ControlError::Finished)
    }

    /// Set an audio track to loop indefinitely.
    ///
    /// This requires either a [`Compose`] to be present or for the
    /// input stream to be seekable.
    ///
    /// [`Input`]: crate::input::Input
    /// [`Compose`]: crate::input::Compose
    pub fn enable_loop(&self) -> TrackResult<()> {
        self.send(TrackCommand::Loop(LoopState::Infinite))
    }

    /// Set an audio track to no longer loop.
    ///
    /// This follows the same rules as [`enable_loop`].
    ///
    /// [`enable_loop`]: Self::enable_loop
    pub fn disable_loop(&self) -> TrackResult<()> {
        self.send(TrackCommand::Loop(LoopState::Finite(NonMaxU32::ZERO)))
    }

    /// Set an audio track to loop a set number of times.
    ///
    /// This follows the same rules as [`enable_loop`].
    ///
    /// [`enable_loop`]: Self::enable_loop
    pub fn loop_for(&self, count: NonMaxU32) -> TrackResult<()> {
        self.send(TrackCommand::Loop(LoopState::Finite(count)))
    }

    /// Returns this handle's (and track's) unique identifier.
    #[must_use]
    pub fn uuid(&self) -> Uuid {
        self.inner.uuid
    }

    /// Allows access to this track's attached Data.
    ///
    /// Data allows additional, user-defined data shared by all handles
    /// to be attached to any track.
    ///
    /// # Panics
    /// This method will panic if the Data has not been initialised, or the type
    /// provided does not equal the type passed to [`Track::new_with_data`].
    #[must_use]
    pub fn data<Data>(&self) -> Arc<Data>
    where
        Data: Send + Sync + 'static,
    {
        Arc::clone(&self.inner.data)
            .downcast()
            .expect("TrackHandle::data generic does not match type set in TrackHandle::set_data")
    }

    #[inline]
    /// Send a raw command to the [`Track`] object.
    ///
    /// [`Track`]: Track
    pub(crate) fn send(&self, cmd: TrackCommand) -> TrackResult<()> {
        // As the send channels are unbounded, we can be reasonably certain
        // that send failure == cancellation.
        self.inner
            .command_channel
            .send(cmd)
            .map_err(|_e| ControlError::Finished)
    }
}

/// Asynchronous reply for an operation applied to a [`TrackHandle`].
///
/// This object does not need to be `.await`ed for the driver to perform an action.
/// Async threads can then call, e.g., [`TrackHandle::make_playable`], and safely drop
/// this callback if the result isn't needed.
pub struct TrackCallback<T> {
    fail: bool,
    rx: Receiver<Result<T, PlayError>>,
}

impl<T> TrackCallback<T> {
    /// Consumes this handle to await a reply from the driver, blocking the current thread.
    pub fn result(self) -> TrackResult<T> {
        if self.fail {
            Err(ControlError::Finished)
        } else {
            self.rx.recv()?.map_err(ControlError::Play)
        }
    }

    /// Consumes this handle to await a reply from the driver asynchronously.
    pub async fn result_async(self) -> TrackResult<T> {
        if self.fail {
            Err(ControlError::Finished)
        } else {
            self.rx.recv_async().await?.map_err(ControlError::Play)
        }
    }

    #[must_use]
    /// Returns `true` if the operation instantly failed due to the target track being
    /// removed.
    pub fn is_hung_up(&self) -> bool {
        self.fail
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{constants::test_data::FILE_WAV_TARGET, driver::Driver, input::File, Config};

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn make_playable_callback_fires() {
        let (t_handle, config) = Config::test_cfg(true);
        let mut driver = Driver::new(config.clone());

        let file = File::new(FILE_WAV_TARGET);
        let handle = driver.play(Track::from(file).pause());

        let callback = handle.make_playable();
        t_handle.spawn_ticker();
        assert!(callback.result_async().await.is_ok());
    }

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn seek_callback_fires() {
        let (t_handle, config) = Config::test_cfg(true);
        let mut driver = Driver::new(config.clone());

        let file = File::new(FILE_WAV_TARGET);
        let handle = driver.play(Track::from(file).pause());

        let target = Duration::from_millis(500);
        let callback = handle.seek(target);
        t_handle.spawn_ticker();

        let answer = callback.result_async().await;
        assert!(answer.is_ok());
        let answer = answer.unwrap();
        let delta = Duration::from_millis(100);
        assert!(answer > target - delta && answer < target + delta);
    }
}
