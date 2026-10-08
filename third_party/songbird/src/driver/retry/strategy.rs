use std::time::Duration;

use rand::random;

use crate::FloatDuration;

/// Logic used to determine how long to wait between retry attempts.
#[derive(Clone, Copy, Debug, PartialEq)]
#[non_exhaustive]
pub enum Strategy {
    /// The driver will wait for the same amount of time between each retry.
    Every(FloatDuration),
    /// Exponential backoff waiting strategy, where the duration between
    /// attempts (approximately) doubles each time.
    Backoff(ExponentialBackoff),
}

impl Strategy {
    pub(crate) fn retry_in(&self, last_wait: Option<FloatDuration>) -> FloatDuration {
        match self {
            Self::Every(t) => *t,
            Self::Backoff(exp) => exp.retry_in(last_wait),
        }
    }
}

/// Exponential backoff waiting strategy.
///
/// Each attempt waits for twice the last delay plus/minus a
/// random jitter, clamped to a min and max value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ExponentialBackoff {
    /// Minimum amount of time to wait between retries.
    ///
    /// *Defaults to 0.25s.*
    pub min: FloatDuration,
    /// Maximum amount of time to wait between retries.
    ///
    /// This will be clamped to `>=` min.
    ///
    /// *Defaults to 10s.*
    pub max: FloatDuration,
    /// Amount of uniform random jitter to apply to generated wait times.
    /// I.e., 0.1 will add +/-10% to generated intervals.
    ///
    /// This is restricted to within +/-100%.
    ///
    /// *Defaults to `0.1`.*
    pub jitter: f32,
}

impl Default for ExponentialBackoff {
    fn default() -> Self {
        Self {
            min: Duration::from_millis(250).into(),
            max: Duration::from_secs(10).into(),
            jitter: 0.1,
        }
    }
}

impl ExponentialBackoff {
    pub(crate) fn retry_in(&self, last_wait: Option<FloatDuration>) -> FloatDuration {
        let min = self.min.as_secs_f32();
        let max = self.max.as_secs_f32();

        let attempt = last_wait.map_or(min, |t| 2.0 * t.as_secs_f32());
        let perturb = (1.0 - (self.jitter * 2.0 * (random::<f32>() - 1.0))).clamp(0.0, 2.0);
        let mut target_time = attempt * perturb;

        // Now clamp target time into given range.
        let safe_max = if max < min { min } else { max };
        target_time = target_time.clamp(min, safe_max);

        FloatDuration::from_secs_f32(target_time)
    }
}
