use std::time::{Duration, Instant};

use discortp::rtp::{MutableRtpPacket, RtpPacket};
use flume::{SendError, TryRecvError};
use tokio::time::Instant as TokInstant;

use crate::{
    constants::*,
    driver::tasks::{error::Error as DriverError, mixer::Mixer},
};

#[cfg(test)]
use crate::driver::test_config::TickStyle;

use super::*;

/// The send-half of a worker thread, with bookkeeping mechanisms to help
/// the idle task schedule incoming tasks.
pub struct Worker {
    id: WorkerId,
    stats: Arc<LiveStatBlock>,
    config: Config,
    tx: Sender<(TaskId, ParkedMixer)>,
    known_empty_since: Option<TokInstant>,
}

#[allow(missing_docs)]
impl Worker {
    pub fn new(
        id: WorkerId,
        config: Config,
        sched_tx: Sender<SchedulerMessage>,
        global_stats: Arc<StatBlock>,
    ) -> Self {
        let stats = Arc::new(LiveStatBlock::default());
        let (live_tx, live_rx) = flume::unbounded();

        let core = Live::new(
            id,
            config.clone(),
            global_stats,
            stats.clone(),
            live_rx,
            sched_tx,
        );
        core.spawn();

        Self {
            id,
            stats,
            config,
            tx: live_tx,
            known_empty_since: None,
        }
    }

    /// Mark the worker thread as idle from the present time if it reports no tasks.
    ///
    /// This time information is used for thread culling.
    #[inline]
    pub fn try_mark_empty(&mut self, now: TokInstant) -> Option<TokInstant> {
        if self.stats.live_mixers() == 0 {
            self.known_empty_since.get_or_insert(now);
        } else {
            self.mark_busy();
        }

        self.known_empty_since
    }

    /// Unset the thread culling time on this worker.
    #[inline]
    pub fn mark_busy(&mut self) {
        self.known_empty_since = None;
    }

    #[cfg(test)]
    #[inline]
    pub fn is_busy(&mut self) -> bool {
        self.known_empty_since.is_none()
    }

    /// Return whether this thread has enough room (task count, spare cycles)
    /// for the given task.
    #[inline]
    #[must_use]
    pub fn can_schedule(&self, task: &ParkedMixer, avoid: Option<WorkerId>) -> bool {
        avoid.is_none_or(|id| !self.has_id(id)) && self.stats.has_room(&self.config.strategy, task)
    }

    #[inline]
    #[must_use]
    pub fn stats(&self) -> Arc<LiveStatBlock> {
        self.stats.clone()
    }

    /// Increment this worker's statistics and hand off a task for execution.
    #[inline]
    pub fn schedule_mixer(
        &mut self,
        id: TaskId,
        task: ParkedMixer,
    ) -> Result<(), SendError<(TaskId, ParkedMixer)>> {
        self.mark_busy();
        self.stats.add_mixer();
        self.tx.send((id, task))
    }

    #[must_use]
    pub fn has_id(&self, id: WorkerId) -> bool {
        self.id == id
    }
}

const PACKETS_PER_BLOCK: usize = 16;
const MEMORY_CULL_TIMER: Duration = Duration::from_secs(10);

/// A synchronous thread responsible for mixing, encoding, encrypting, and
/// sending the audio output of many `Mixer`s.
///
/// `Mixer`s remain `Box`ed due to large move costs, and unboxing them appeared to have
/// a 5--10% perf cost from benchmarks.
pub struct Live {
    packets: Vec<Box<[u8]>>,
    packet_lens: Vec<usize>,
    #[allow(clippy::vec_box)]
    tasks: Vec<Box<Mixer>>,
    ids: Vec<TaskId>,
    to_cull: Vec<bool>,

    deadline: Instant,
    start_of_work: Option<Instant>,

    id: WorkerId,
    config: Config,
    stats: Arc<LiveStatBlock>,
    global_stats: Arc<StatBlock>,
    rx: Receiver<(TaskId, ParkedMixer)>,
    tx: Sender<SchedulerMessage>,

    excess_buffer_cull_time: Option<Instant>,
}

#[allow(missing_docs)]
impl Live {
    pub fn new(
        id: WorkerId,
        config: Config,
        global_stats: Arc<StatBlock>,
        stats: Arc<LiveStatBlock>,
        rx: Receiver<(TaskId, ParkedMixer)>,
        tx: Sender<SchedulerMessage>,
    ) -> Self {
        let to_prealloc = config.strategy.prealloc_size();

        let block_size = config
            .strategy
            .task_limit()
            .unwrap_or(PACKETS_PER_BLOCK)
            .min(PACKETS_PER_BLOCK);

        let packets = vec![packet_block(block_size)];

        Self {
            packets,
            packet_lens: Vec::with_capacity(to_prealloc),
            tasks: Vec::with_capacity(to_prealloc),
            ids: Vec::with_capacity(to_prealloc),
            to_cull: Vec::with_capacity(to_prealloc),

            deadline: Instant::now(),
            start_of_work: None,

            id,
            config,
            stats,
            global_stats,
            rx,
            tx,

            excess_buffer_cull_time: None,
        }
    }

    #[inline]
    fn run(&mut self) {
        while self.run_once() {}
        self.global_stats.remove_worker();
    }

    /// Returns whether the loop should exit (i.e., culled by main `Scheduler`).
    #[inline]
    pub fn run_once(&mut self) -> bool {
        // Check for new tasks.
        if self.handle_scheduler_msgs().is_err() {
            return false;
        }

        // Receive commands for each task.
        self.handle_task_msgs();

        // Move any idle calls back to the global pool.
        self.demote_and_remove_mixers();

        // Take a clock measure before and after each packet.
        let mut pre_pkt_time = Instant::now();
        let mut worst_task = (0, Duration::default());

        for (i, (packet_len, mixer)) in self
            .packet_lens
            .iter_mut()
            .zip(self.tasks.iter_mut())
            .enumerate()
        {
            let (block, inner) = get_memory_indices(i);
            match mixer.mix_and_build_packet(&mut self.packets[block][inner..][..VOICE_PACKET_MAX])
            {
                Ok(written_sz) => *packet_len = written_sz,
                e => {
                    *packet_len = 0;
                    rebuild_if_err(mixer, e, &mut self.to_cull, i);
                },
            }
            let post_pkt_time = Instant::now();
            let cost = post_pkt_time.duration_since(pre_pkt_time);
            if cost > worst_task.1 {
                worst_task = (i, cost);
            }
            pre_pkt_time = post_pkt_time;
        }

        let end_of_work = pre_pkt_time;

        if let Some(start_of_work) = self.start_of_work {
            let ns_cost = self.stats.store_compute_cost(end_of_work - start_of_work);

            if self.config.move_expensive_tasks
                && ns_cost >= RESCHEDULE_THRESHOLD
                && self.ids.len() > 1
            {
                self.offload_mixer(worst_task.0, worst_task.1);
            }
        }

        self.timed_remove_excess_blocks(end_of_work);

        // Wait till the right time to send this packet:
        // usually a 20ms tick, in test modes this is either a finite number of runs or user input.
        self.march_deadline();

        // Send all.
        self.start_of_work = Some(Instant::now());
        for (i, (packet_len, mixer)) in self
            .packet_lens
            .iter_mut()
            .zip(self.tasks.iter_mut())
            .enumerate()
        {
            let (block, inner) = get_memory_indices(i);
            let packet = &mut self.packets[block][inner..];
            if *packet_len > 0 {
                let res = mixer.send_packet(&packet[..*packet_len]);
                rebuild_if_err(mixer, res, &mut self.to_cull, i);
            }
            #[cfg(test)]
            if *packet_len == 0 {
                mixer.test_signal_empty_tick();
            }
            advance_rtp_counters(packet);
        }

        for (i, mixer) in self.tasks.iter_mut().enumerate() {
            let res = mixer
                .audio_commands_events()
                .and_then(|()| mixer.check_and_send_keepalive(self.start_of_work));
            rebuild_if_err(mixer, res, &mut self.to_cull, i);
        }

        true
    }

    #[cfg(test)]
    fn _march_deadline(&mut self) {
        // For testing, assume all will have same tick style.
        // Only count 'remaining loops' on one of the nodes.
        let mixer = self.tasks.get_mut(0).map(|m| {
            let style = m.config.tick_style.clone();
            (m, style)
        });

        match mixer {
            None | Some((_, TickStyle::Timed)) => {
                std::thread::sleep(self.deadline.saturating_duration_since(Instant::now()));
                self.deadline += TIMESTEP_LENGTH;
            },
            Some((m, TickStyle::UntimedWithExecLimit(rx))) => {
                if m.remaining_loops.is_none() {
                    if let Ok(new_val) = rx.recv() {
                        m.remaining_loops = Some(new_val.wrapping_sub(1));
                    }
                }

                if let Some(cnt) = m.remaining_loops.as_mut() {
                    if *cnt == 0 {
                        m.remaining_loops = None;
                    } else {
                        *cnt = cnt.wrapping_sub(1);
                    }
                }
            },
        }
    }

    #[cfg(not(test))]
    #[inline(always)]
    #[allow(clippy::inline_always)]
    fn _march_deadline(&mut self) {
        std::thread::sleep(self.deadline.saturating_duration_since(Instant::now()));
        self.deadline += TIMESTEP_LENGTH;
    }

    #[inline]
    fn march_deadline(&mut self) {
        #[cfg(feature = "internals")]
        {
            return;
        }

        #[allow(clippy::used_underscore_items)]
        self._march_deadline();
    }

    #[inline]
    fn handle_scheduler_msgs(&mut self) -> Result<(), ()> {
        let mut activation_time = None;
        loop {
            match self.rx.try_recv() {
                Ok((id, task)) => {
                    self.add_task(
                        task,
                        id,
                        *activation_time.get_or_insert_with(|| {
                            self.deadline
                                .checked_sub(TIMESTEP_LENGTH)
                                .unwrap_or(self.deadline)
                        }),
                    );
                },
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Err(()),
            }
        }

        Ok(())
    }

    /// Handle messages from each tasks's `Driver`, marking dead tasks for removal.
    #[inline]
    fn handle_task_msgs(&mut self) {
        for (i, (packet, mixer)) in self
            .packets
            .iter_mut()
            .flat_map(|v| v.chunks_exact_mut(VOICE_PACKET_MAX))
            .zip(self.tasks.iter_mut())
            .enumerate()
        {
            let mut events_failure = false;
            let mut conn_failure = false;

            let fatal = loop {
                match mixer.mix_rx.try_recv() {
                    Ok(m) => {
                        let (events, conn, should_exit) = mixer.handle_message(m, packet);
                        events_failure |= events;
                        conn_failure |= conn;

                        if should_exit {
                            break true;
                        }
                    },
                    Err(TryRecvError::Disconnected) => {
                        break true;
                    },

                    Err(TryRecvError::Empty) => {
                        break false;
                    },
                }
            };

            if fatal || mixer.do_rebuilds(events_failure, conn_failure).is_err() {
                // this is not zipped in because it is *not* needed most ticks.
                self.to_cull[i] = true;
            }
        }
    }

    #[cfg(feature = "internals")]
    #[inline]
    pub fn mark_for_cull(&mut self, idx: usize) {
        self.to_cull[idx] = true;
    }

    /// Check and demote for any tasks without live audio sources who have sent all
    /// necessary silent frames (or remove dead tasks).
    ///
    /// This must occur *after* handling per-track events to prevent erroneously
    /// descheduling tasks.
    #[inline]
    pub fn demote_and_remove_mixers(&mut self) {
        let mut i = 0;
        while i < self.tasks.len() {
            #[cfg(test)]
            let force_conn = self.tasks[i].config.override_connection.is_some();
            #[cfg(not(test))]
            let force_conn = false;

            // Benchmarking suggests that these asserts remove some bounds checks for us.
            assert!(i < self.tasks.len());
            assert!(i < self.to_cull.len());

            if self.to_cull[i]
                || (self.tasks[i].tracks.is_empty() && self.tasks[i].silence_frames == 0)
                || !(self.tasks[i].conn_active.is_some() || force_conn)
            {
                self.stats.remove_mixer();

                if let Some((id, parked)) = self.remove_task(i) {
                    self.global_stats.move_mixer_to_idle();
                    _ = self.tx.send(SchedulerMessage::Demote(id, parked));
                } else {
                    self.global_stats.remove_live_mixer();
                }
            } else {
                i += 1;
            }
        }
    }

    /// Return a given mixer to the main scheduler if this worker is overloaded.
    #[inline]
    pub fn offload_mixer(&mut self, idx: usize, cost: Duration) {
        self.stats.remove_mixer();

        if let Some((id, mut parked)) = self.remove_task(idx) {
            self.global_stats.move_mixer_to_idle();
            parked.last_cost = Some(cost);
            _ = self
                .tx
                .send(SchedulerMessage::Overspill(self.id, id, parked));
        } else {
            self.global_stats.remove_live_mixer();
        }
    }

    #[inline]
    fn needed_blocks(&self) -> usize {
        let div = self.ids.len() / PACKETS_PER_BLOCK;
        let rem = self.ids.len() % PACKETS_PER_BLOCK;
        (rem != 0) as usize + div
    }

    #[inline]
    fn has_excess_blocks(&self) -> bool {
        self.packets.len() > self.needed_blocks()
    }

    #[inline]
    fn remove_excess_blocks(&mut self) {
        self.packets.truncate(self.needed_blocks());
    }

    /// Try to offload excess packet buffers.
    ///
    /// If there is currently overallocation, then store the first time at which
    /// this was seenb. If this condition persists past `MEMORY_CULL_TIMER`, remove
    /// unnecessary blocks.
    #[inline]
    fn timed_remove_excess_blocks(&mut self, now: Instant) {
        if self.has_excess_blocks() {
            if let Some(mark_time) = self.excess_buffer_cull_time {
                if now.duration_since(mark_time) >= MEMORY_CULL_TIMER {
                    self.remove_excess_blocks();
                    self.excess_buffer_cull_time = None;
                }
            } else {
                self.excess_buffer_cull_time = Some(now);
            }
        } else {
            self.excess_buffer_cull_time = None;
        }
    }

    #[inline]
    fn add_task(&mut self, task: ParkedMixer, id: TaskId, activation_time: Instant) {
        let idx = self.ids.len();

        let elapsed = task.park_time - activation_time;

        let samples_f64 = elapsed.as_secs_f64() * (SAMPLE_RATE_RAW as f64);
        let mod_samples = (samples_f64 as u64) as u32;
        let rtp_timestamp = task.rtp_timestamp.wrapping_add(mod_samples);

        self.ids.push(id);
        self.tasks.push(task.mixer);
        self.packet_lens.push(0);
        self.to_cull.push(false);

        let (block, inner_idx) = get_memory_indices(idx);

        while self.packets.len() <= block {
            self.add_packet_block();
        }
        let packet = &mut self.packets[block][inner_idx..][..VOICE_PACKET_MAX];

        let mut rtp = MutableRtpPacket::new(packet).expect(
            "FATAL: Too few bytes in self.packet for RTP header.\
                (Blame: VOICE_PACKET_MAX?)",
        );
        rtp.set_ssrc(task.ssrc);
        rtp.set_timestamp(rtp_timestamp.into());
        rtp.set_sequence(task.rtp_sequence.into());
    }

    /// Allocate and store a new packet block.
    ///
    /// This will be full-size (`PACKETS_PER_BLOCK`) unless this block
    /// is a) the last required for the task limit and b) this limit
    /// is not aligned to `PACKETS_PER_BLOCK`.
    #[inline]
    fn add_packet_block(&mut self) {
        let n_packets = if let Some(limit) = self.config.strategy.task_limit() {
            let (block, inner) = get_memory_indices_unscaled(limit);
            if self.packets.len() < block || inner == 0 {
                PACKETS_PER_BLOCK
            } else {
                inner
            }
        } else {
            PACKETS_PER_BLOCK
        };
        self.packets.push(packet_block(n_packets));
    }

    #[cfg(any(test, feature = "internals"))]
    #[inline]
    pub fn add_task_direct(&mut self, task: Mixer, id: TaskId) {
        let id_0 = id.get();
        self.add_task(
            ParkedMixer {
                mixer: Box::new(task),
                ssrc: id_0 as u32,
                rtp_sequence: id_0 as u16,
                rtp_timestamp: id_0 as u32,
                park_time: Instant::now(),
                last_cost: None,
                cull_handle: None,
            },
            id,
            Instant::now(),
        );
    }

    /// Remove a `Mixer`, returning it to the idle scheduler.
    ///
    /// This operates by `swap_remove`ing each element of a Mixer's state, including
    /// on RTP packet headers. This is achieved by setting up a memcpy between
    /// buffer segments.
    #[inline]
    pub fn remove_task(&mut self, idx: usize) -> Option<(TaskId, ParkedMixer)> {
        let end = self.tasks.len() - 1;

        let id = self.ids.swap_remove(idx);
        let _len = self.packet_lens.swap_remove(idx);
        let mixer = self.tasks.swap_remove(idx);
        let alive = !self.to_cull.swap_remove(idx);

        let (block, inner_idx) = get_memory_indices(idx);

        let (removed, replacement) = if end > idx {
            let (end_block, end_inner) = get_memory_indices(end);
            let (rest, target_block) = self.packets.split_at_mut(end_block);
            let (last_block, end_pkt) = target_block[0].split_at_mut(end_inner);

            if end_block == block {
                (&mut last_block[inner_idx..], Some(end_pkt))
            } else {
                (&mut rest[block][inner_idx..], Some(end_pkt))
            }
        } else {
            (&mut self.packets[block][inner_idx..], None)
        };

        let rtp = RtpPacket::new(removed).expect(
            "FATAL: Too few bytes in self.packet for RTP header.\
                (Blame: VOICE_PACKET_MAX?)",
        );
        let ssrc = rtp.get_ssrc();
        let rtp_timestamp = rtp.get_timestamp().into();
        let rtp_sequence = rtp.get_sequence().into();

        if let Some(replacement) = replacement {
            // Copy the whole packet header since we know it'll be 4B aligned.
            // 'Just necessary fields' is 2B aligned.
            const COPY_LEN: usize = RtpPacket::minimum_packet_size();
            removed[..COPY_LEN].copy_from_slice(&replacement[..COPY_LEN]);
        }

        alive.then(move || {
            let park_time = Instant::now();

            (
                id,
                ParkedMixer {
                    mixer,
                    ssrc,
                    rtp_sequence,
                    rtp_timestamp,
                    park_time,
                    last_cost: None,
                    cull_handle: None,
                },
            )
        })
    }

    /// Spawn a new sync thread to manage `Mixer`s.
    fn spawn(mut self) {
        std::thread::spawn(move || {
            self.run();
        });
    }
}

/// Initialises a packet block of the required size, prefilling any constant RTP data.
#[inline]
fn packet_block(n_packets: usize) -> Box<[u8]> {
    let mut packets = vec![0u8; VOICE_PACKET_MAX * n_packets].into_boxed_slice();

    for packet in packets.chunks_exact_mut(VOICE_PACKET_MAX) {
        let mut rtp = MutableRtpPacket::new(packet).expect(
            "FATAL: Too few bytes in self.packet for RTP header.\
                (Blame: VOICE_PACKET_MAX?)",
        );
        rtp.set_version(RTP_VERSION);
        rtp.set_payload_type(RTP_PROFILE_TYPE);
    }

    packets
}

/// Returns the block index into `self.packets` and the packet number in
/// the block for a given worker's index.
#[inline]
fn get_memory_indices_unscaled(idx: usize) -> (usize, usize) {
    let block_size = PACKETS_PER_BLOCK;
    (idx / block_size, idx % block_size)
}

/// Returns the block index into `self.packets` and the byte offset into
/// a packet block for a given worker's index.
#[inline]
fn get_memory_indices(idx: usize) -> (usize, usize) {
    let (block, inner_unscaled) = get_memory_indices_unscaled(idx);
    (block, inner_unscaled * VOICE_PACKET_MAX)
}

#[inline]
fn advance_rtp_counters(packet: &mut [u8]) {
    let mut rtp = MutableRtpPacket::new(packet).expect(
        "FATAL: Too few bytes in self.packet for RTP header.\
            (Blame: VOICE_PACKET_MAX?)",
    );
    rtp.set_sequence(rtp.get_sequence() + 1);
    rtp.set_timestamp(rtp.get_timestamp() + MONO_FRAME_SIZE as u32);
}

/// Structured slightly confusingly: we only want to even access `cull_markers`
/// in the event of error.
#[inline]
fn rebuild_if_err<T>(
    mixer: &mut Box<Mixer>,
    res: Result<T, DriverError>,
    cull_markers: &mut [bool],
    idx: usize,
) {
    if let Err(e) = res {
        cull_markers[idx] |= mixer
            .do_rebuilds(
                e.should_trigger_interconnect_rebuild(),
                e.should_trigger_connect(),
            )
            .is_err();
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::driver::test_impls::*;
    use tokio::runtime::Handle;

    fn rtp_has_index(pkt: &[u8], sentinel_val: u16) {
        let rtp = RtpPacket::new(pkt).unwrap();

        assert_eq!(rtp.get_version(), RTP_VERSION);
        assert_eq!(rtp.get_padding(), 0);
        assert_eq!(rtp.get_extension(), 0);
        assert_eq!(rtp.get_csrc_count(), 0);
        assert_eq!(rtp.get_marker(), 0);
        assert_eq!(rtp.get_payload_type(), RTP_PROFILE_TYPE);
        assert_eq!(rtp.get_sequence(), sentinel_val.into());
        assert_eq!(rtp.get_timestamp(), (sentinel_val as u32).into());
        assert_eq!(rtp.get_ssrc(), sentinel_val as u32);
    }

    #[tokio::test]
    async fn block_alloc_is_partial_small() {
        let n_mixers = 1;
        let (sched, _listeners) = MockScheduler::from_mixers(
            Some(Mode::MaxPerThread(n_mixers.try_into().unwrap())),
            (0..n_mixers)
                .map(|_| Mixer::test_with_float(1, Handle::current(), false))
                .collect(),
        );

        assert_eq!(sched.core.packets.len(), 1);
        assert_eq!(sched.core.packets[0].len(), VOICE_PACKET_MAX);
    }

    #[tokio::test]
    async fn block_alloc_is_partial_large() {
        let n_mixers = 33;
        let (sched, _listeners) = MockScheduler::from_mixers(
            Some(Mode::MaxPerThread(n_mixers.try_into().unwrap())),
            (0..n_mixers)
                .map(|_| Mixer::test_with_float(1, Handle::current(), false))
                .collect(),
        );

        assert_eq!(sched.core.packets.len(), 3);
        assert_eq!(
            sched.core.packets[0].len(),
            PACKETS_PER_BLOCK * VOICE_PACKET_MAX
        );
        assert_eq!(
            sched.core.packets[1].len(),
            PACKETS_PER_BLOCK * VOICE_PACKET_MAX
        );
        assert_eq!(sched.core.packets[2].len(), VOICE_PACKET_MAX);
    }

    #[tokio::test]
    async fn deletion_moves_pkt_header() {
        let (mut sched, _listeners) = MockScheduler::from_mixers(
            None,
            (0..PACKETS_PER_BLOCK)
                .map(|_| Mixer::test_with_float(1, Handle::current(), false))
                .collect(),
        );

        let last_idx = (PACKETS_PER_BLOCK - 1) as u16;

        // Remove head.
        sched.core.remove_task(0);
        rtp_has_index(&sched.core.packets[0], last_idx);

        // Remove head.
        sched.core.remove_task(5);
        rtp_has_index(&sched.core.packets[0][5 * VOICE_PACKET_MAX..], last_idx - 1);
    }

    #[tokio::test]
    async fn deletion_moves_pkt_header_multiblock() {
        let n_pkts = PACKETS_PER_BLOCK + 8;
        let (mut sched, _listeners) = MockScheduler::from_mixers(
            None,
            (0..n_pkts)
                .map(|_| Mixer::test_with_float(1, Handle::current(), false))
                .collect(),
        );

        let last_idx = (n_pkts - 1) as u16;

        // Remove head (read from block 1 into block 0).
        sched.core.remove_task(0);
        rtp_has_index(&sched.core.packets[0], last_idx);

        // Remove later (read from block 1 into block 1).
        sched.core.remove_task(17);
        rtp_has_index(&sched.core.packets[1][VOICE_PACKET_MAX..], last_idx - 1);
    }

    #[tokio::test]
    async fn packet_blocks_are_cleaned_up() {
        // Allocate 2 blocks.
        let n_pkts = PACKETS_PER_BLOCK + 1;
        let (mut sched, _listeners) = MockScheduler::from_mixers(
            None,
            (0..n_pkts)
                .map(|_| Mixer::test_with_float(1, Handle::current(), false))
                .collect(),
        );

        // Assert no cleanup at start.
        assert!(sched.core.run_once());
        assert_eq!(sched.core.needed_blocks(), 2);
        assert!(sched.core.excess_buffer_cull_time.is_none());

        // Remove only entry in last block. Cleanup should be sched'd.
        sched.core.remove_task(n_pkts - 1);
        assert!(sched.core.run_once());
        assert!(sched.core.has_excess_blocks());
        assert!(sched.core.excess_buffer_cull_time.is_some());

        tokio::time::sleep(Duration::from_secs(2) + MEMORY_CULL_TIMER).await;

        // Cleanup should be unsched'd.
        assert!(sched.core.run_once());
        assert!(sched.core.excess_buffer_cull_time.is_none());
        assert!(!sched.core.has_excess_blocks());
    }
}
