use super::*;

/// Configuration for how a [`Scheduler`] handles tasks.
///
/// [`Scheduler`]: super::Scheduler
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct Config {
    /// How Live mixer tasks will be mapped to individual threads.
    ///
    /// Defaults to `Mode::MaxPerThread(16)`.
    pub strategy: Mode,
    /// Move costly mixers to another thread if their parent worker is at
    /// risk of missing its deadlines.
    ///
    /// Defaults to `true`.
    pub move_expensive_tasks: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            strategy: Mode::default(),
            move_expensive_tasks: true,
        }
    }
}

/// Strategies for mapping live mixer tasks to individual threads.
///
/// Defaults to `MaxPerThread(16)`.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum Mode {
    /// Allows at most `n` tasks to run per thread.
    MaxPerThread(NonZeroUsize),
}

impl Mode {
    /// Returns the number of `Mixer`s that a scheduler should preallocate
    /// resources for.
    pub(crate) fn prealloc_size(&self) -> usize {
        match self {
            Self::MaxPerThread(n) => n.get(),
        }
    }

    /// Returns the maximum number of concurrent mixers that a scheduler is
    /// allowed to place on a single thread.
    ///
    /// Future scheduling modes may choose to limit *only* on execution cost.
    #[allow(clippy::unnecessary_wraps)]
    pub(crate) fn task_limit(&self) -> Option<usize> {
        match self {
            Self::MaxPerThread(n) => Some(n.get()),
        }
    }
}

impl Default for Mode {
    fn default() -> Self {
        Self::MaxPerThread(DEFAULT_MIXERS_PER_THREAD)
    }
}
