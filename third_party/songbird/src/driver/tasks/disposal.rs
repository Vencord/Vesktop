use super::message::*;
use flume::{Receiver, Sender};
use tracing::{instrument, trace};

#[derive(Debug, Clone)]
pub struct DisposalThread(Sender<DisposalMessage>);

impl Default for DisposalThread {
    fn default() -> Self {
        Self::run()
    }
}

impl DisposalThread {
    #[must_use]
    pub fn run() -> Self {
        let (mix_tx, mix_rx) = flume::unbounded();
        std::thread::spawn(move || {
            trace!("Disposal thread started.");
            runner(mix_rx);
            trace!("Disposal thread finished.");
        });

        Self(mix_tx)
    }

    pub(super) fn dispose(&self, message: DisposalMessage) {
        drop(self.0.send(message));
    }
}

/// The mixer's disposal thread is also synchronous, due to tracks,
/// inputs, etc. being based on synchronous I/O.
///
/// The mixer uses this to offload heavy and expensive drop operations
/// to prevent deadline misses.
#[instrument(skip(mix_rx))]
#[expect(
    clippy::needless_pass_by_value,
    reason = "spawned on background thread, must take by value"
)]
fn runner(mix_rx: Receiver<DisposalMessage>) {
    while mix_rx.recv().is_ok() {}
}
