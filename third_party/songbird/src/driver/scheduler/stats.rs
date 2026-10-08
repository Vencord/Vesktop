use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use super::{Mode, ParkedMixer, RESCHEDULE_THRESHOLD};

/// Statistics shared by an entire `Scheduler`.
#[derive(Debug, Default)]
pub struct StatBlock {
    total: AtomicU64,
    live: AtomicU64,
    threads: AtomicU64,
}

#[allow(missing_docs)]
impl StatBlock {
    #[inline]
    pub fn total_mixers(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn live_mixers(&self) -> u64 {
        self.live.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn worker_threads(&self) -> u64 {
        self.threads.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn add_idle_mixer(&self) {
        self.total.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn remove_idle_mixers(&self, n: u64) {
        self.total.fetch_sub(n, Ordering::Relaxed);
    }

    #[inline]
    pub fn move_mixer_to_live(&self) {
        self.live.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn move_mixer_to_idle(&self) {
        self.move_mixers_to_idle(1);
    }

    #[inline]
    pub fn move_mixers_to_idle(&self, n: u64) {
        self.live.fetch_sub(n, Ordering::Relaxed);
    }

    #[inline]
    pub fn remove_live_mixer(&self) {
        self.remove_live_mixers(1);
    }

    #[inline]
    pub fn remove_live_mixers(&self, n: u64) {
        self.move_mixers_to_idle(n);
        self.remove_idle_mixers(n);
    }

    #[inline]
    pub fn add_worker(&self) {
        self.threads.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn remove_worker(&self) {
        self.threads.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Runtime statistics for an individual worker.
///
/// Individual statistics are measured atomically -- the worker thread
/// may have been cleaned up, or its mixer count may not match the
/// count when [`Self::last_compute_cost_ns`] was set.
#[derive(Debug, Default)]
pub struct LiveStatBlock {
    live: AtomicU64,
    last_ns: AtomicU64,
}

impl LiveStatBlock {
    /// Returns the number of mixer tasks scheduled on this worker thread.
    #[inline]
    pub fn live_mixers(&self) -> u64 {
        self.live.load(Ordering::Relaxed)
    }

    #[inline]
    pub(crate) fn add_mixer(&self) {
        self.live.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub(crate) fn remove_mixer(&self) {
        self.live.fetch_sub(1, Ordering::Relaxed);
    }

    #[inline]
    pub(crate) fn store_compute_cost(&self, work: Duration) -> u64 {
        let cost = work.as_nanos() as u64;
        self.last_ns.store(cost, Ordering::Relaxed);
        cost
    }

    /// Returns the number of nanoseconds required to process all worker threads'
    /// packet transmission, mixing, encoding, and encryption in the last tick.
    #[inline]
    pub fn last_compute_cost_ns(&self) -> u64 {
        self.last_ns.load(Ordering::Relaxed)
    }

    #[inline]
    pub(crate) fn has_room(&self, strategy: &Mode, task: &ParkedMixer) -> bool {
        let task_room = strategy
            .task_limit()
            .is_none_or(|limit| self.live_mixers() < limit as u64);

        let exec_room = task.last_cost.is_none_or(|cost| {
            cost.as_nanos() as u64 + self.last_compute_cost_ns() < RESCHEDULE_THRESHOLD
        });

        task_room && exec_room
    }
}
