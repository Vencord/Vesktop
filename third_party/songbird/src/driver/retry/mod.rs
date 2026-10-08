//! Configuration for connection retries.

mod strategy;

pub use self::strategy::*;

use std::num::NonZeroU8;

use crate::FloatDuration;

/// Configuration to be used for retrying driver connection attempts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Retry {
    /// Strategy used to determine how long to wait between retry attempts.
    ///
    /// *Defaults to an [`ExponentialBackoff`] from 0.25s
    /// to 10s, with a jitter of `0.1`.*
    ///
    /// [`ExponentialBackoff`]: Strategy::Backoff
    pub strategy: Strategy,
    /// The maximum number of retries to attempt.
    ///
    /// `None` will attempt an infinite number of retries,
    /// while `Some(0)` will attempt to connect *once* (no retries).
    ///
    /// *Defaults to `Some(5)`.*
    pub retry_limit: Option<NonZeroU8>,
}

impl Default for Retry {
    fn default() -> Self {
        Self {
            strategy: Strategy::Backoff(ExponentialBackoff::default()),
            retry_limit: Some(const { NonZeroU8::new(5).unwrap() }),
        }
    }
}

impl Retry {
    pub(crate) fn retry_in(
        &self,
        last_wait: Option<FloatDuration>,
        attempts: u8,
    ) -> Option<FloatDuration> {
        if self.retry_limit.is_none_or(|a| attempts < a.get()) {
            Some(self.strategy.retry_in(last_wait))
        } else {
            None
        }
    }
}
