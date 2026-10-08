use std::{
    error::Error as StdError,
    fmt::Display,
    num::NonZeroUsize,
    sync::{Arc, OnceLock},
};

use flume::{Receiver, RecvError, Sender};

use super::tasks::message::{Interconnect, MixerMessage};
use crate::{constants::TIMESTEP_LENGTH, Config as DriverConfig};

mod config;
mod idle;
mod live;
mod stats;
mod task;

pub use config::*;
use idle::*;
pub use live::*;
pub use stats::*;
pub use task::*;

/// A soft maximum of 90% of the 20ms budget to account for variance in execution time.
const RESCHEDULE_THRESHOLD: u64 = ((TIMESTEP_LENGTH.subsec_nanos() as u64) * 9) / 10;

const DEFAULT_MIXERS_PER_THREAD: NonZeroUsize = match NonZeroUsize::new(16) {
    Some(v) => v,
    None => unreachable!(),
};

/// The default shared scheduler instance.
///
/// This is built using the default value of [`ScheduleMode`]. Users desiring
/// a custom strategy should avoid calling [`Config::default`].
///
/// [`Config::default`]: crate::Config::default
/// [`ScheduleMode`]: Mode
pub fn get_default_scheduler() -> &'static Scheduler {
    static DEFAULT_SCHEDULER: OnceLock<Scheduler> = OnceLock::new();
    DEFAULT_SCHEDULER.get_or_init(Scheduler::default)
}

/// A reference to a shared group of threads used for running idle and active
/// audio threads.
#[derive(Clone, Debug)]
pub struct Scheduler {
    inner: Arc<InnerScheduler>,
}

/// Inner contents of a [`Scheduler`] instance.
///
/// This is an `Arc` around `Arc`'d contents so that we can make use of the
/// drop check on `Scheduler` to clean up resources.
#[derive(Clone, Debug)]
struct InnerScheduler {
    tx: Sender<SchedulerMessage>,
    stats: Arc<StatBlock>,
}

impl Scheduler {
    /// Create a new mixer scheduler from the allocation strategy in `config`.
    #[must_use]
    pub fn new(config: Config) -> Self {
        let (core, tx) = Idle::new(config);

        let stats = core.stats.clone();
        core.spawn();

        let inner = Arc::new(InnerScheduler { tx, stats });

        Self { inner }
    }

    pub(crate) fn new_mixer(
        &self,
        config: &DriverConfig,
        ic: Interconnect,
        rx: Receiver<MixerMessage>,
    ) {
        self.inner
            .tx
            .send(SchedulerMessage::NewMixer(rx, ic, config.clone()))
            .unwrap();
    }

    /// Returns the total number of calls (idle and active) scheduled.
    #[must_use]
    pub fn total_tasks(&self) -> u64 {
        self.inner.stats.total_mixers()
    }

    /// Returns the total number of *active* calls scheduled and processing
    /// audio.
    #[must_use]
    pub fn live_tasks(&self) -> u64 {
        self.inner.stats.live_mixers()
    }

    /// Returns the total number of threads spawned to process live audio sessions.
    #[must_use]
    pub fn worker_threads(&self) -> u64 {
        self.inner.stats.worker_threads()
    }

    /// Request a list of handles to statistics for currently live workers.
    pub async fn worker_thread_stats(&self) -> Result<Vec<Arc<LiveStatBlock>>, Error> {
        let (tx, rx) = flume::bounded(1);
        _ = self.inner.tx.send(SchedulerMessage::GetStats(tx));

        rx.recv_async().await.map_err(Error::from)
    }

    /// Request a list of handles to statistics for currently live workers with a blocking call.
    pub fn worker_thread_stats_blocking(&self) -> Result<Vec<Arc<LiveStatBlock>>, Error> {
        let (tx, rx) = flume::bounded(1);
        _ = self.inner.tx.send(SchedulerMessage::GetStats(tx));

        rx.recv().map_err(Error::from)
    }
}

impl Drop for InnerScheduler {
    fn drop(&mut self) {
        _ = self.tx.send(SchedulerMessage::Kill);
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Scheduler::new(Config::default())
    }
}

/// Control messages for a scheduler.
pub enum SchedulerMessage {
    /// Build a new `Mixer` as part of the initialisation of a `Driver`.
    NewMixer(Receiver<MixerMessage>, Interconnect, DriverConfig),
    /// Forward a command for
    Do(TaskId, MixerMessage),
    /// Return a `Mixer` from a worker back to the idle pool.
    Demote(TaskId, ParkedMixer),
    /// Move an expensive `Mixer` to another thread in the worker pool.
    Overspill(WorkerId, TaskId, ParkedMixer),
    /// Request a copy of all per-worker statistics.
    GetStats(Sender<Vec<Arc<LiveStatBlock>>>),
    /// Cleanup once all `Scheduler` handles are dropped.
    Kill,
}

/// Errors encountered when communicating with the internals of a [`Scheduler`].
///
/// [`Scheduler`]: crate::driver::Scheduler
#[non_exhaustive]
#[derive(Debug)]
pub enum Error {
    /// The scheduler exited or crashed while awating the request.
    Disconnected,
}

impl Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disconnected => f.write_str("the scheduler terminated mid-request"),
        }
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        None
    }
}

impl From<RecvError> for Error {
    fn from(_: RecvError) -> Self {
        Self::Disconnected
    }
}
