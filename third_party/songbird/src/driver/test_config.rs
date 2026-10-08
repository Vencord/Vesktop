#![allow(missing_docs)]

use flume::{Receiver, Sender};

use crate::{
    tracks::{PlayMode, TrackHandle, TrackState},
    Event,
    EventContext,
    EventHandler,
    TrackEvent,
};
use std::time::Duration;

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum TickStyle {
    Timed,
    UntimedWithExecLimit(Receiver<u64>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutputMessage {
    Passthrough(Vec<u8>),
    Mixed(Vec<f32>),
    Silent,
}

#[allow(dead_code)]
impl OutputMessage {
    #[must_use]
    pub fn is_passthrough(&self) -> bool {
        matches!(self, Self::Passthrough(_))
    }

    #[must_use]
    pub fn is_mixed(&self) -> bool {
        matches!(self, Self::Mixed(_))
    }

    #[must_use]
    pub fn is_mixed_with_nonzero_signal(&self) -> bool {
        if let Self::Mixed(data) = self {
            data.iter().any(|v| *v != 0.0f32)
        } else {
            false
        }
    }

    #[must_use]
    pub fn is_explicit_silence(&self) -> bool {
        *self == Self::Silent
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum OutputMode {
    Raw(Sender<TickMessage<OutputMessage>>),
    Rtp(Sender<TickMessage<Vec<u8>>>),
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum TickMessage<T> {
    El(T),
    NoEl,
}

impl<T> From<T> for TickMessage<T> {
    fn from(val: T) -> Self {
        TickMessage::El(val)
    }
}

impl From<TickMessage<OutputMessage>> for OutputPacket {
    fn from(val: TickMessage<OutputMessage>) -> Self {
        match val {
            TickMessage::El(e) => OutputPacket::Raw(e),
            TickMessage::NoEl => OutputPacket::Empty,
        }
    }
}

impl From<TickMessage<Vec<u8>>> for OutputPacket {
    fn from(val: TickMessage<Vec<u8>>) -> Self {
        match val {
            TickMessage::El(e) => OutputPacket::Rtp(e),
            TickMessage::NoEl => OutputPacket::Empty,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutputPacket {
    Raw(OutputMessage),
    Rtp(Vec<u8>),
    Empty,
}

impl OutputPacket {
    #[must_use]
    pub fn raw(&self) -> Option<&OutputMessage> {
        if let Self::Raw(o) = self {
            Some(o)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug)]
pub enum OutputReceiver {
    Raw(Receiver<TickMessage<OutputMessage>>),
    Rtp(Receiver<TickMessage<Vec<u8>>>),
}

#[derive(Clone)]
pub struct DriverTestHandle {
    pub rx: OutputReceiver,
    pub tx: Sender<u64>,
}

impl DriverTestHandle {
    #[must_use]
    pub fn recv(&self) -> OutputPacket {
        match &self.rx {
            OutputReceiver::Raw(rx) => rx.recv().unwrap().into(),
            OutputReceiver::Rtp(rx) => rx.recv().unwrap().into(),
        }
    }

    pub async fn recv_async(&self) -> OutputPacket {
        match &self.rx {
            OutputReceiver::Raw(rx) => rx.recv_async().await.unwrap().into(),
            OutputReceiver::Rtp(rx) => rx.recv_async().await.unwrap().into(),
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        match &self.rx {
            OutputReceiver::Raw(rx) => rx.len(),
            OutputReceiver::Rtp(rx) => rx.len(),
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn wait(&self, n_ticks: u64) {
        for _i in 0..n_ticks {
            drop(self.recv());
        }
    }

    pub async fn wait_async(&self, n_ticks: u64) {
        for _i in 0..n_ticks {
            drop(self.recv_async().await);
        }
    }

    pub fn spawn_ticker(&self) {
        let remote = self.clone();
        tokio::spawn(async move {
            loop {
                remote.skip(1).await;
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
    }

    pub fn wait_noisy(&self, n_ticks: u64) {
        for _i in 0..n_ticks {
            match self.recv() {
                OutputPacket::Empty => eprintln!("pkt: Nothing"),
                OutputPacket::Rtp(p) => eprintln!("pkt: RTP[{}B]", p.len()),
                OutputPacket::Raw(OutputMessage::Silent) => eprintln!("pkt: Raw-Silent"),
                OutputPacket::Raw(OutputMessage::Passthrough(p)) => {
                    eprintln!("pkt: Raw-Passthrough[{}B]", p.len());
                },
                OutputPacket::Raw(OutputMessage::Mixed(p)) => {
                    eprintln!("pkt: Raw-Mixed[{}B]", p.len());
                },
            }
        }
    }

    pub async fn skip(&self, n_ticks: u64) {
        self.tick(n_ticks);
        self.wait_async(n_ticks).await;
    }

    pub fn tick(&self, n_ticks: u64) {
        assert!(
            n_ticks != 0,
            "Number of ticks to advance driver/mixer must be >= 1."
        );

        self.tx.send(n_ticks).unwrap();
    }

    pub async fn ready_track(
        &self,
        handle: &TrackHandle,
        tick_wait: Option<Duration>,
    ) -> TrackState {
        struct SongPlayable {
            tx: Sender<TrackState>,
        }

        #[async_trait::async_trait]
        impl EventHandler for SongPlayable {
            async fn act(&self, ctx: &crate::EventContext<'_>) -> Option<Event> {
                if let EventContext::Track(&[(state, _)]) = ctx {
                    drop(self.tx.send(state.clone()));
                }

                Some(Event::Cancel)
            }
        }

        struct SongErred {
            tx: Sender<PlayMode>,
        }

        #[async_trait::async_trait]
        impl EventHandler for SongErred {
            async fn act(&self, ctx: &crate::EventContext<'_>) -> Option<Event> {
                if let EventContext::Track(&[(state, _)]) = ctx {
                    drop(self.tx.send(state.playing.clone()));
                }

                Some(Event::Cancel)
            }
        }

        let (tx, rx) = flume::bounded(1);
        let (err_tx, err_rx) = flume::bounded(1);

        handle
            .add_event(Event::Track(TrackEvent::Playable), SongPlayable { tx })
            .expect("Adding track evt should not fail before any ticks.");

        handle
            .add_event(Event::Track(TrackEvent::Error), SongErred { tx: err_tx })
            .expect("Adding track evt should not fail before any ticks.");

        loop {
            self.tick(1);
            tokio::time::sleep(tick_wait.unwrap_or_else(|| Duration::from_millis(20))).await;
            self.wait_async(1).await;

            match err_rx.try_recv() {
                Ok(e) => panic!("Error reported on track: {e:?}"),
                Err(flume::TryRecvError::Empty | flume::TryRecvError::Disconnected) => {},
            }

            match rx.try_recv() {
                Ok(val) => return val,
                Err(flume::TryRecvError::Disconnected) => panic!(),
                Err(flume::TryRecvError::Empty) => {},
            }
        }
    }
}
