use nonmax::NonMaxU32;

/// Looping behaviour for a [`Track`].
///
/// [`Track`]: struct.Track.html
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LoopState {
    /// Track will loop endlessly until loop state is changed or
    /// manually stopped.
    Infinite,

    /// Track will loop `n` more times.
    ///
    /// `Finite(0)` is the `Default`, stopping the track once its [`Input`] ends.
    ///
    /// [`Input`]: crate::input::Input
    Finite(NonMaxU32),
}

impl Default for LoopState {
    fn default() -> Self {
        Self::Finite(NonMaxU32::ZERO)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        constants::test_data::FILE_WAV_TARGET,
        driver::Driver,
        input::File,
        tracks::{PlayMode, Track, TrackState},
        Config,
        Event,
        EventContext,
        EventHandler,
        TrackEvent,
    };
    use flume::Sender;

    struct Looper {
        tx: Sender<TrackState>,
    }

    #[async_trait::async_trait]
    impl EventHandler for Looper {
        async fn act(&self, ctx: &crate::EventContext<'_>) -> Option<Event> {
            if let EventContext::Track(&[(state, _)]) = ctx {
                drop(self.tx.send(state.clone()));
            }

            None
        }
    }

    #[tokio::test]
    #[ntest::timeout(15_000)]
    async fn finite_track_loops_work() {
        let (t_handle, config) = Config::test_cfg(true);
        let mut driver = Driver::new(config.clone());

        let file = File::new(FILE_WAV_TARGET);
        let handle = driver
            .play(Track::from(file).loops(LoopState::Finite(const { NonMaxU32::new(2).unwrap() })));

        let (l_tx, l_rx) = flume::unbounded();
        let (e_tx, e_rx) = flume::unbounded();
        let _ = handle.add_event(Event::Track(TrackEvent::Loop), Looper { tx: l_tx });
        let _ = handle.add_event(Event::Track(TrackEvent::End), Looper { tx: e_tx });

        t_handle.spawn_ticker();

        // CONDITIONS:
        // 1) 2 loop events, each changes the loop count.
        // 2) Track ends.
        // 3) Playtime >> Position
        assert_eq!(
            l_rx.recv_async().await.map(|v| v.loops),
            Ok(LoopState::Finite(NonMaxU32::ONE))
        );
        assert_eq!(
            l_rx.recv_async().await.map(|v| v.loops),
            Ok(LoopState::Finite(NonMaxU32::ZERO))
        );
        let ended = e_rx.recv_async().await;

        assert!(ended.is_ok());

        let ended = ended.unwrap();
        assert!(ended.play_time > 2 * ended.position);
    }

    #[tokio::test]
    #[ntest::timeout(15_000)]
    async fn infinite_track_loops_work() {
        let (t_handle, config) = Config::test_cfg(true);
        let mut driver = Driver::new(config.clone());

        let file = File::new(FILE_WAV_TARGET);
        let handle = driver.play(Track::from(file).loops(LoopState::Infinite));

        let (l_tx, l_rx) = flume::unbounded();
        let _ = handle.add_event(Event::Track(TrackEvent::Loop), Looper { tx: l_tx });

        t_handle.spawn_ticker();

        // CONDITIONS:
        // 1) 3 loop events, each does not change the loop count.
        // 2) Track still playing at final
        // 3) Playtime >> Position
        assert_eq!(
            l_rx.recv_async().await.map(|v| v.loops),
            Ok(LoopState::Infinite)
        );
        assert_eq!(
            l_rx.recv_async().await.map(|v| v.loops),
            Ok(LoopState::Infinite)
        );

        let final_state = l_rx.recv_async().await;
        assert_eq!(
            final_state.as_ref().map(|v| v.loops),
            Ok(LoopState::Infinite)
        );
        let final_state = final_state.unwrap();

        assert_eq!(final_state.playing, PlayMode::Play);
        assert!(final_state.play_time > 2 * final_state.position);
    }
}
