//! Various driver internals which need to be exported for benchmarking.
//!
//! Included if using the `"internals"` feature flag.
//! You should not and/or cannot use these as part of a normal application.

#![allow(missing_docs)]

pub use super::tasks::{message as task_message, mixer};

pub use super::crypto::{Cipher, CryptoState};

use crate::{
    driver::tasks::message::TrackContext,
    tracks::{Track, TrackHandle},
};

#[must_use]
pub fn track_context(t: Track) -> (TrackHandle, TrackContext) {
    t.into_context()
}

pub mod scheduler {
    pub use crate::driver::scheduler::*;
}
