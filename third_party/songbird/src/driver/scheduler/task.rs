use std::{
    marker::PhantomData,
    time::{Duration, Instant},
};

use flume::{Receiver, Sender};
use nohash_hasher::IsEnabled;
use rand::random;
use tokio::runtime::Handle;

use crate::{
    driver::tasks::{
        error::Error as DriverError,
        message::{EventMessage, Interconnect, MixerMessage},
        mixer::Mixer,
    },
    Config,
};

use super::SchedulerMessage;

/// Typesafe counter used to identify individual mixer/worker instances.
#[derive(Copy, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ResId<T>(u64, PhantomData<T>);
#[allow(missing_docs)]
pub type TaskId = ResId<TaskMarker>;
#[allow(missing_docs)]
pub type WorkerId = ResId<WorkerMarker>;

#[allow(missing_docs)]
#[derive(Copy, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TaskMarker;
#[allow(missing_docs)]
#[derive(Copy, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorkerMarker;

impl<T> IsEnabled for ResId<T> {}

#[allow(missing_docs)]
impl<T: Copy> ResId<T> {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn incr(&mut self) -> Self {
        let out = *self;
        self.0 = self.0.wrapping_add(1);
        out
    }

    #[cfg(any(test, feature = "internals"))]
    #[must_use]
    pub fn get(self) -> u64 {
        self.0
    }
}

impl<T: Copy> Default for ResId<T> {
    fn default() -> Self {
        Self(0, PhantomData)
    }
}

/// An idle mixer instance, externally controlled by a `Driver`.
///
/// Since we do not allocate packet buffers for idle threads, this
/// struct includes various RTP fields.
pub struct ParkedMixer {
    /// Mixer, track, etc. state as well as message receivers.
    pub mixer: Box<Mixer>,
    /// The SSRC assigned to this voice session.
    pub ssrc: u32,
    /// The last recorded/generated RTP sequence.
    pub rtp_sequence: u16,
    /// The last recorded/generated RTP timestamp.
    pub rtp_timestamp: u32,
    /// The time at which this `Mixer` was made idle.
    ///
    /// This is used when transitioning to a live state to determine
    /// how far we should adjust the RTP timestamp by.
    pub park_time: Instant,
    /// The last known cost of executing this task, if it had to be moved
    /// due to a limit on thread resources.
    pub last_cost: Option<Duration>,
    /// Handle to any forwarder task, used if this mixer is culled while idle.
    pub cull_handle: Option<Sender<()>>,
}

#[allow(missing_docs)]
impl ParkedMixer {
    /// Create a new `Mixer` in a parked state.
    #[must_use]
    pub fn new(mix_rx: Receiver<MixerMessage>, interconnect: Interconnect, config: Config) -> Self {
        Self {
            mixer: Box::new(Mixer::new(mix_rx, Handle::current(), interconnect, config)),
            ssrc: 0,
            rtp_sequence: random::<u16>(),
            rtp_timestamp: random::<u32>(),
            park_time: Instant::now(),
            last_cost: None,
            cull_handle: None,
        }
    }

    /// Spawn a tokio task which forwards any mixer messages to the central `Idle` task pool.
    ///
    /// Any requests which would cause this mixer to become live will terminate
    /// this task.
    pub fn spawn_forwarder(&mut self, tx: Sender<SchedulerMessage>, id: TaskId) {
        let (kill_tx, kill_rx) = flume::bounded(1);
        self.cull_handle = Some(kill_tx);

        let remote_rx = self.mixer.mix_rx.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    _ = kill_rx.recv_async() => break,
                    msg = remote_rx.recv_async() => {
                        let exit = if let Ok(msg) = msg {
                            let remove_self = msg.is_mixer_maybe_live();
                            tx.send_async(SchedulerMessage::Do(id, msg)).await.is_err() || remove_self
                        } else {
                            true
                        };

                        if exit {
                            break;
                        }
                    }
                }
            }
        });
    }

    /// Returns whether the mixer should exit and be cleaned up.
    pub fn handle_message(&mut self, msg: MixerMessage) -> Result<bool, ()> {
        match msg {
            MixerMessage::SetConn(conn, ssrc) => {
                // Overridden because payload-specific fields are carried
                // externally on `ParkedMixer`.
                self.ssrc = ssrc;
                self.rtp_sequence = random::<u16>();
                self.rtp_timestamp = random::<u32>();
                self.mixer.conn_active = Some(conn);
                self.mixer.update_keepalive(ssrc);

                Ok(false)
            },
            MixerMessage::Ws(ws) => {
                // Overridden so that we don't mistakenly tell Discord we're speaking.
                self.mixer.ws = ws;
                self.send_gateway_not_speaking();

                Ok(false)
            },
            msg => {
                let (events_failure, conn_failure, should_exit) =
                    self.mixer.handle_message(msg, &mut []);

                self.mixer
                    .do_rebuilds(events_failure, conn_failure)
                    .map_err(|_| ())
                    .map(|()| should_exit)
            },
        }
    }

    /// Handle periodic events attached to this `Mixer`, including timer state
    /// on the event thread and UDP keepalives needed to prevent session termination.
    ///
    /// As we init our UDP sockets as non-blocking via Tokio -> `into_std`, it is
    /// safe to call UDP packet sends like this.
    pub fn tick_and_keepalive(&mut self, now: Instant) -> Result<(), ()> {
        // TODO: should we include an atomic which signals whether the event
        //  thread *cares*, so we can prevent wakeups?
        //  Can we do the same for live tracks?
        let mut events_failure = self.mixer.fire_event(EventMessage::Tick).is_err();

        let ka_err = self
            .mixer
            .check_and_send_keepalive(Some(now))
            .or_else(DriverError::disarm_would_block);

        let conn_failure = if let Err(e) = ka_err {
            events_failure |= e.should_trigger_interconnect_rebuild();
            e.should_trigger_connect()
        } else {
            false
        };

        self.mixer
            .do_rebuilds(events_failure, conn_failure)
            .map_err(|_| ())
    }

    pub fn send_gateway_speaking(&mut self) -> Result<(), ()> {
        if let Err(e) = self.mixer.send_gateway_speaking() {
            self.mixer
                .do_rebuilds(
                    e.should_trigger_interconnect_rebuild(),
                    e.should_trigger_connect(),
                )
                .map_err(|_| ())
        } else {
            Ok(())
        }
    }

    pub fn send_gateway_not_speaking(&self) {
        self.mixer.send_gateway_not_speaking();
    }
}
