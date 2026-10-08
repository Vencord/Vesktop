//! Runner for a voice connection.
//!
//! Songbird's driver is a mixed-sync system, using:
//!  * Asynchronous connection management, event-handling, and gateway integration.
//!  * Synchronous audio mixing, packet generation, and encoding.
//!
//! This splits up work according to its IO/compute bound nature, preventing packet
//! generation from being slowed down past its deadline, or from affecting other
//! asynchronous tasks your bot must handle.

#[cfg(feature = "internals")]
pub mod bench_internals;

pub(crate) mod connection;
mod crypto;
#[cfg(feature = "receive")]
mod decode_mode;
mod mix_mode;
pub mod retry;
mod scheduler;
pub(crate) mod tasks;
#[cfg(test)]
pub(crate) mod test_config;
#[cfg(any(test, feature = "internals"))]
mod test_impls;

use connection::error::{Error, Result};
pub use crypto::CryptoMode;
pub(crate) use crypto::CryptoState;
#[cfg(feature = "receive")]
pub use decode_mode::*;
pub use mix_mode::MixMode;
pub use scheduler::{
    get_default_scheduler,
    Config as SchedulerConfig,
    Error as SchedulerError,
    LiveStatBlock,
    Mode as SchedulerMode,
    Scheduler,
};
#[cfg(test)]
pub use test_config::*;
#[cfg(any(test, feature = "internals"))]
pub use test_impls::*;

#[cfg(feature = "builtin-queue")]
use crate::tracks::TrackQueue;
use crate::{
    events::EventData,
    input::Input,
    tracks::{Track, TrackHandle},
    Config,
    ConnectionInfo,
    Event,
    EventHandler,
};
use core::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};
use flume::{r#async::RecvFut, SendError, Sender};
/// Opus encoder bitrate settings.
pub use opus2::{self as opus, Bitrate};
#[cfg(feature = "builtin-queue")]
use std::time::Duration;
#[allow(unused_imports)]
pub use tasks::disposal::DisposalThread;
use tasks::message::CoreMessage;
use tracing::instrument;

/// The control object for a Discord voice connection, handling connection,
/// mixing, encoding, en/decryption, and event generation.
///
/// When compiled with the `"builtin-queue"` feature, each driver includes a track queue
/// as a convenience to prevent the additional overhead of per-guild state management.
#[derive(Clone, Debug)]
pub struct Driver {
    config: Config,
    self_mute: bool,
    sender: Sender<CoreMessage>,
    // Making this an Option is an abhorrent hack to coerce the borrow checker
    // into letting us have an &TrackQueue at the same time as an &mut Driver.
    // This is probably preferable to cloning the driver: Arc<...> should be nonzero
    // and if the compiler's smart we'll just codegen a pointer swap. It definitely makes
    // use of NonZero.
    #[cfg(feature = "builtin-queue")]
    queue: Option<TrackQueue>,
}

impl Driver {
    /// Creates a new voice driver.
    ///
    /// This will create the core voice tasks in the background.
    #[inline]
    #[must_use]
    pub fn new(config: Config) -> Self {
        let sender = Self::start_inner(config.clone());

        Driver {
            config,
            self_mute: false,
            sender,
            #[cfg(feature = "builtin-queue")]
            queue: Some(TrackQueue::default()),
        }
    }

    fn start_inner(config: Config) -> Sender<CoreMessage> {
        let (tx, rx) = flume::unbounded();

        tasks::start(config, rx, tx.clone());

        tx
    }

    fn restart_inner(&mut self) {
        self.sender = Self::start_inner(self.config.clone());

        self.mute(self.self_mute);
    }

    /// Connects to a voice channel using the specified server.
    ///
    /// This method instantly contacts the driver tasks, and its
    /// does not need to be `await`ed to start the actual connection.
    #[instrument(skip(self))]
    pub fn connect(&mut self, info: ConnectionInfo) -> Connect {
        let (tx, rx) = flume::bounded(1);

        self.raw_connect(info, tx);

        Connect {
            inner: rx.into_recv_async(),
        }
    }

    /// Connects to a voice channel using the specified server.
    #[instrument(skip(self))]
    pub(crate) fn raw_connect(&mut self, info: ConnectionInfo, tx: Sender<Result<()>>) {
        self.send(CoreMessage::ConnectWithResult(info, tx));
    }

    /// Leaves the current voice channel, disconnecting from it.
    ///
    /// This does *not* forget settings, like whether to be self-deafened or
    /// self-muted.
    #[instrument(skip(self))]
    pub fn leave(&mut self) {
        self.send(CoreMessage::Disconnect);
    }

    /// Sets whether the current connection is to be muted.
    ///
    /// If there is no live voice connection, then this only acts as a settings
    /// update for future connections.
    #[instrument(skip(self))]
    pub fn mute(&mut self, mute: bool) {
        self.self_mute = mute;
        self.send(CoreMessage::Mute(mute));
    }

    /// Returns whether the driver is muted (i.e., processes audio internally
    /// but submits none).
    #[instrument(skip(self))]
    pub fn is_mute(&self) -> bool {
        self.self_mute
    }

    /// Plays audio from an input, returning a handle for further control.
    #[instrument(skip(self, input))]
    pub fn play_input(&mut self, input: Input) -> TrackHandle {
        self.play(input.into())
    }

    /// Plays audio from an input, returning a handle for further control.
    ///
    /// Unlike [`Self::play_input`], this stops all other inputs attached
    /// to the channel.
    #[instrument(skip(self, input))]
    pub fn play_only_input(&mut self, input: Input) -> TrackHandle {
        self.play_only(input.into())
    }

    /// Plays audio from a [`Track`] object.
    ///
    /// The main difference between this function and [`Self::play_input`] is
    /// that this allows for direct manipulation of the [`Track`] object
    /// before it is passed over to the voice and mixing contexts.
    #[instrument(skip(self, track))]
    pub fn play(&mut self, track: Track) -> TrackHandle {
        let (handle, ctx) = track.into_context();
        self.send(CoreMessage::AddTrack(Box::new(ctx)));

        handle
    }

    /// Exclusively plays audio from a [`Track`] object.
    ///
    /// As in [`Self::play_only_input`], this stops all other sources attached to the
    /// channel. Like [`Self::play`], however, this allows for direct manipulation of the
    /// [`Track`] object before it is passed over to the voice and mixing contexts.
    #[instrument(skip(self, track))]
    pub fn play_only(&mut self, track: Track) -> TrackHandle {
        let (handle, ctx) = track.into_context();
        self.send(CoreMessage::SetTrack(Some(Box::new(ctx))));

        handle
    }

    /// Sets the bitrate for encoding Opus packets sent along
    /// the channel being managed.
    ///
    /// The default rate is 128 kbps.
    /// Sensible values range between `Bits(512)` and `Bits(512_000)`
    /// bits per second.
    /// Alternatively, `Auto` and `Max` remain available.
    #[instrument(skip(self))]
    pub fn set_bitrate(&mut self, bitrate: Bitrate) {
        self.send(CoreMessage::SetBitrate(bitrate));
    }

    /// Stops playing audio from all sources, if any are set.
    #[instrument(skip(self))]
    pub fn stop(&mut self) {
        self.send(CoreMessage::SetTrack(None));
    }

    /// Sets the configuration for this driver (and parent `Call`, if applicable).
    #[instrument(skip(self))]
    /// FastDiscord patch: seeds the MLS-recognized roster from the client's
    /// own gateway view. User accounts never receive op 11 (ClientsConnect),
    /// so the DAVE handshake would otherwise only ever recognize this
    /// account — fresh SSRCs after far-side re-joins then fail to decrypt
    /// (upstream #310).
    pub fn set_recognized_users(&mut self, users: Vec<u64>) {
        let ids: Vec<crate::model::id::UserId> =
            users.into_iter().map(crate::model::id::UserId).collect();
        self.send(CoreMessage::SetRecognizedUsers(ids));
    }

    /// Sets the configuration for this driver.
    ///
    /// Any changes to the driver's configuration will apply on the next
    /// connection attempt, or where otherwise noted.
    pub fn set_config(&mut self, config: Config) {
        self.config = config.clone();
        self.send(CoreMessage::SetConfig(config));
    }

    /// Returns a view of this driver's configuration.
    #[instrument(skip(self))]
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Attach a global event handler to an audio context. Global events may receive
    /// any [`EventContext`].
    ///
    /// Global timing events will tick regardless of whether audio is playing,
    /// so long as the bot is connected to a voice channel, and have no tracks.
    /// [`TrackEvent`]s will respond to all relevant tracks, giving some audio elements.
    ///
    /// Users **must** ensure that no costly work or blocking occurs
    /// within the supplied function or closure. *Taking excess time could prevent
    /// timely sending of packets, causing audio glitches and delays*.
    ///
    /// [`TrackEvent`]: crate::events::TrackEvent
    /// [`EventContext`]: crate::events::EventContext
    #[instrument(skip(self, action))]
    pub fn add_global_event<F: EventHandler + 'static>(&mut self, event: Event, action: F) {
        self.send(CoreMessage::AddEvent(EventData::new(event, action)));
    }

    /// Removes all global event handlers from an audio context.
    #[instrument(skip(self))]
    pub fn remove_all_global_events(&mut self) {
        self.send(CoreMessage::RemoveGlobalEvents);
    }

    /// Sends a message to the inner tasks, restarting it if necessary.
    fn send(&mut self, status: CoreMessage) {
        // Restart thread if it errored.
        if let Err(SendError(status)) = self.sender.send(status) {
            self.restart_inner();

            self.sender.send(status).unwrap();
        }
    }
}

#[cfg(feature = "builtin-queue")]
impl Driver {
    /// Returns a reference to this driver's built-in queue.
    ///
    /// Requires the `"builtin-queue"` feature.
    /// Queue additions should be made via [`Driver::enqueue`] and
    /// [`Driver::enqueue_input`].
    #[must_use]
    pub fn queue(&self) -> &TrackQueue {
        self.queue
            .as_ref()
            .expect("Queue: The only case this can fail is if a previous queue operation panicked.")
    }

    /// Adds an audio [`Input`] to this driver's built-in queue.
    ///
    /// Requires the `"builtin-queue"` feature.
    pub async fn enqueue_input(&mut self, input: Input) -> TrackHandle {
        self.enqueue(input.into()).await
    }

    /// Adds an existing [`Track`] to this driver's built-in queue.
    ///
    /// Requires the `"builtin-queue"` feature.
    pub async fn enqueue(&mut self, mut track: Track) -> TrackHandle {
        let preload_time = TrackQueue::get_preload_time(&mut track).await;
        self.enqueue_with_preload(track, preload_time)
    }

    /// Add an existing [`Track`] to the queue, using a known time to preload the next track.
    ///
    /// See [`TrackQueue::add_with_preload`] for how `preload_time` is used.
    ///
    /// Requires the `"builtin-queue"` feature.
    pub fn enqueue_with_preload(
        &mut self,
        track: Track,
        preload_time: Option<Duration>,
    ) -> TrackHandle {
        let queue = self.queue.take().expect(
            "Enqueue: The only case this can fail is if a previous queue operation panicked.",
        );
        let handle = queue.add_with_preload(track, self, preload_time);
        self.queue = Some(queue);

        handle
    }
}

impl Default for Driver {
    fn default() -> Self {
        Self::new(Config::default())
    }
}

impl Drop for Driver {
    /// Leaves the current connected voice channel, if connected to one, and
    /// forgets all configurations relevant to this Handler.
    fn drop(&mut self) {
        drop(self.sender.send(CoreMessage::Poison));
    }
}

/// Future for a call to [`Driver::connect`].
///
/// This future awaits the *result* of a connection; the driver
/// is messaged at the time of the call.
pub struct Connect {
    inner: RecvFut<'static, Result<()>>,
}

impl Future for Connect {
    type Output = Result<()>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match Pin::new(&mut self.inner).poll(cx) {
            Poll::Ready(r) => Poll::Ready(r.map_err(|_| Error::AttemptDiscarded).and_then(|x| x)),
            Poll::Pending => Poll::Pending,
        }
    }
}
