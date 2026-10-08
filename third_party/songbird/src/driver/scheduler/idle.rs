use std::{collections::HashMap, time::Duration};

use nohash_hasher::{BuildNoHashHasher, IntMap};
use tokio::time::{Instant as TokInstant, Interval};
use tracing::info;

use crate::constants::*;

use super::*;

const THREAD_CULL_TIMER: Duration = Duration::from_secs(60);

/// An async task responsible for maintaining UDP keepalives and event state for inactive
/// `Mixer` tasks.
pub(crate) struct Idle {
    config: Config,
    cull_timer: Duration,
    tasks: IntMap<TaskId, ParkedMixer>,
    // track taskids which are live to prevent their realloc? unlikely w u64 but still
    pub(crate) stats: Arc<StatBlock>,
    rx: Receiver<SchedulerMessage>,
    tx: Sender<SchedulerMessage>,
    next_id: TaskId,
    next_worker_id: WorkerId,
    workers: Vec<Worker>,
    to_cull: Vec<TaskId>,
}

impl Idle {
    pub fn new(config: Config) -> (Self, Sender<SchedulerMessage>) {
        let (tx, rx) = flume::unbounded();

        let stats = Arc::default();
        let tasks = HashMap::with_capacity_and_hasher(128, BuildNoHashHasher::default());

        // TODO: include heap of keepalive sending times?
        let out = Self {
            config,
            cull_timer: THREAD_CULL_TIMER,
            tasks,
            stats,
            rx,
            tx: tx.clone(),
            next_id: TaskId::new(),
            next_worker_id: WorkerId::new(),
            workers: Vec::with_capacity(16),
            to_cull: vec![],
        };

        (out, tx)
    }

    /// Run the inner task until all external `Scheduler` handles are dropped.
    async fn run(&mut self) {
        let mut interval = tokio::time::interval(TIMESTEP_LENGTH);
        while self.run_once(&mut interval).await {}
    }

    /// Run one 'tick' of idle thread maintenance.
    ///
    /// This is a priority system over 2 main tasks:
    ///  1) handle scheduling/upgrade/action requests for mixers
    ///  2) [every 20ms]tick the main timer for each task, send keepalive if
    ///     needed, reclaim & cull workers.
    ///
    /// Idle mixers spawn an async task each to forward their `MixerMessage`s
    /// on to this task to be handled by 1). These tasks self-terminate if a
    /// message would make a mixer `now_live`.
    async fn run_once(&mut self, interval: &mut Interval) -> bool {
        tokio::select! {
            biased;
            msg = self.rx.recv_async() => match msg {
                Ok(SchedulerMessage::NewMixer(rx, ic, cfg)) => {
                    let mut mixer = ParkedMixer::new(rx, ic, cfg);
                    let id = self.next_id.incr();

                    mixer.spawn_forwarder(self.tx.clone(), id);
                    self.tasks.insert(id, mixer);
                    self.stats.add_idle_mixer();
                },
                Ok(SchedulerMessage::Demote(id, mut task)) => {
                    task.send_gateway_not_speaking();

                    task.spawn_forwarder(self.tx.clone(), id);
                    self.tasks.insert(id, task);
                },
                Ok(SchedulerMessage::Do(id, mix_msg)) => {
                    let maybe_live = mix_msg.is_mixer_maybe_live();
                    if let Some(task) = self.tasks.get_mut(&id) {
                        match task.handle_message(mix_msg) {
                            Ok(false) if maybe_live => {
                                if task.mixer.tracks.is_empty() {
                                    // No tracks, likely due to SetConn.
                                    // Recreate message forwarding task.
                                    task.spawn_forwarder(self.tx.clone(), id);
                                } else {
                                    let task = self.tasks.remove(&id).unwrap();
                                    self.schedule_mixer(task, id, None);
                                }
                            },
                            Ok(false) => {},
                            Ok(true) | Err(()) => self.to_cull.push(id),
                        }
                    } else {
                        info!("Received post-cull message for {id:?}, discarding.");
                    }
                },
                Ok(SchedulerMessage::Overspill(worker_id, id, task)) => {
                    self.schedule_mixer(task, id, Some(worker_id));
                },
                Ok(SchedulerMessage::GetStats(tx)) => {
                    _ = tx.send(self.workers.iter().map(Worker::stats).collect());
                },
                Ok(SchedulerMessage::Kill) | Err(_) => {
                    return false;
                },
            },
            _ = interval.tick() => {
                // TODO: store keepalive sends in another data structure so
                // we don't check every task every 20ms.
                //
                // if we can also make tick handling lazy(er), we can also optimise for that.
                let now = TokInstant::now();

                for (id, task) in &mut self.tasks {
                    // NOTE: this is a non-blocking send so safe from async context.
                    if task.tick_and_keepalive(now.into()).is_err() {
                        self.to_cull.push(*id);
                    }
                }

                let mut i = 0;
                while i < self.workers.len() {
                    if let Some(then) = self.workers[i].try_mark_empty(now) {
                        if now.duration_since(then) >= self.cull_timer {
                            self.workers.swap_remove(i);
                            continue;
                        }
                    }

                    i += 1;
                }
            },
        }

        for id in self.to_cull.drain(..) {
            if let Some(tx) = self.tasks.remove(&id).and_then(|t| t.cull_handle) {
                _ = tx.send_async(()).await;
            }
        }

        true
    }

    /// Promote a task to a live mixer thread.
    fn schedule_mixer(&mut self, mut task: ParkedMixer, id: TaskId, avoid: Option<WorkerId>) {
        if task.send_gateway_speaking().is_ok() {
            // If a worker ever completely fails, then we need to remove it here
            // `fetch_worker` will either find another, or generate us a new one if
            // none exist.

            // We need to track ownership of the task coming back via SendError using this
            // Option.
            let mut loop_task = Some(task);
            loop {
                let task = loop_task.take().unwrap();
                let (worker, idx) = self.fetch_worker(&task, avoid);
                match worker.schedule_mixer(id, task) {
                    Ok(()) => {
                        self.stats.move_mixer_to_live();
                        break;
                    },
                    Err(e) => {
                        loop_task = Some(e.0 .1);
                        let worker = self.workers.swap_remove(idx);

                        // NOTE: we have incremented worker's live counter for this mixer in
                        // `schedule_mixer`.
                        // The only time this branch is ever hit is if a worker crashed, so we
                        // need to replicate some of their cleanup.
                        self.stats
                            .remove_live_mixers(worker.stats().live_mixers().saturating_sub(1));
                        self.stats.remove_worker();
                    },
                }
            }
        }
    }

    /// Fetch the first `Worker` that has room for a new task, creating one if needed.
    ///
    /// If an inbound task has spilled from another thread, then do not reschedule it there.
    fn fetch_worker(
        &mut self,
        task: &ParkedMixer,
        avoid: Option<WorkerId>,
    ) -> (&mut Worker, usize) {
        let idx = self
            .workers
            .iter()
            .position(|w| w.can_schedule(task, avoid))
            .unwrap_or_else(|| {
                self.workers.push(Worker::new(
                    self.next_worker_id.incr(),
                    self.config.clone(),
                    self.tx.clone(),
                    self.stats.clone(),
                ));
                self.stats.add_worker();
                self.workers.len() - 1
            });

        (&mut self.workers[idx], idx)
    }

    pub fn spawn(mut self) {
        tokio::spawn(async move { self.run().await });
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::{
        constants::test_data::FILE_WEBM_TARGET,
        driver::{tasks::mixer::Mixer, OutputMode},
        input::File,
        Driver,
    };
    use tokio::runtime::Handle;

    #[tokio::test]
    async fn inactive_mixers_dont_need_threads() {
        let sched = Scheduler::new(Config::default());
        let cfg = DriverConfig::default().scheduler(sched.clone());

        let _drivers: Vec<Driver> = (0..1024).map(|_| Driver::new(cfg.clone())).collect();
        tokio::time::sleep(Duration::from_secs(1)).await;

        assert_eq!(sched.total_tasks(), 1024);
        assert_eq!(sched.live_tasks(), 0);
        assert_eq!(sched.worker_threads(), 0);
    }

    #[tokio::test]
    async fn active_mixers_spawn_threads() {
        let config = Config {
            strategy: Mode::default(),
            move_expensive_tasks: false,
        };

        let sched = Scheduler::new(config);
        let (pkt_tx, _pkt_rx) = flume::unbounded();
        let cfg = DriverConfig::default()
            .scheduler(sched.clone())
            .override_connection(Some(OutputMode::Rtp(pkt_tx)));

        let n_tasks = 1024;

        let _drivers: Vec<Driver> = (0..n_tasks)
            .map(|_| {
                let mut driver = Driver::new(cfg.clone());
                let file = File::new(FILE_WEBM_TARGET);
                driver.play_input(file.into());
                driver
            })
            .collect();
        tokio::time::sleep(Duration::from_secs(10)).await;

        assert_eq!(sched.total_tasks(), n_tasks);
        assert_eq!(sched.live_tasks(), n_tasks);
        assert_eq!(
            sched.worker_threads(),
            n_tasks / (DEFAULT_MIXERS_PER_THREAD.get() as u64)
        );
    }

    #[tokio::test]
    async fn excess_threads_are_cleaned_up() {
        const TEST_TIMER: Duration = Duration::from_millis(500);

        let config = Config {
            strategy: Mode::MaxPerThread(1.try_into().unwrap()),
            move_expensive_tasks: true,
        };

        let (mut core, tx) = Idle::new(config.clone());
        core.cull_timer = TEST_TIMER;

        let mut next_id = TaskId::new();
        let mut thread_id = WorkerId::new();
        let mut handles = vec![];
        for i in 0..2 {
            let mut worker = Worker::new(
                thread_id.incr(),
                config.clone(),
                tx.clone(),
                core.stats.clone(),
            );
            let ((mixer, listeners), track_handle) =
                Mixer::test_with_float_unending(Handle::current(), false);

            let send_mixer = ParkedMixer {
                mixer: Box::new(mixer),
                ssrc: i,
                rtp_sequence: i as u16,
                rtp_timestamp: i,
                park_time: TokInstant::now().into(),
                last_cost: None,
                cull_handle: None,
            };
            core.stats.add_idle_mixer();
            core.stats.move_mixer_to_live();
            worker.schedule_mixer(next_id.incr(), send_mixer).unwrap();
            handles.push((track_handle, listeners));
            core.workers.push(worker);
        }

        let mut timer = tokio::time::interval(TIMESTEP_LENGTH);
        assert!(core.run_once(&mut timer).await);

        // Stop one of the handles, allow it to exit, and then run core again.
        handles[1].0.stop().unwrap();
        while core.workers[1].is_busy() {
            assert!(core.run_once(&mut timer).await);
        }

        tokio::time::sleep(TEST_TIMER + Duration::from_secs(1)).await;
        while core.workers.len() != 1 {
            assert!(core.run_once(&mut timer).await);
        }

        assert_eq!(core.stats.worker_threads(), 0);
    }
}
