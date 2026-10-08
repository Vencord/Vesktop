use super::*;

/// State of an [`Track`] object, designed to be passed to event handlers
/// and retrieved remotely via [`TrackHandle::get_info`].
///
/// [`Track`]: Track
/// [`TrackHandle::get_info`]: TrackHandle::get_info
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TrackState {
    /// Play status (e.g., active, paused, stopped) of this track.
    pub playing: PlayMode,

    /// Current volume of this track.
    pub volume: f32,

    /// Current playback position in the source.
    ///
    /// This is altered by loops and seeks, and represents this track's
    /// position in its underlying input stream.
    pub position: Duration,

    /// Total playback time, increasing monotonically.
    pub play_time: Duration,

    /// Remaining loops on this track.
    pub loops: LoopState,

    /// Whether this track has been made live, is being processed, or is
    /// currently uninitialised.
    pub ready: ReadyState,
}

impl TrackState {
    pub(crate) fn step_frame(&mut self) {
        self.position += TIMESTEP_LENGTH;
        self.play_time += TIMESTEP_LENGTH;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{constants::test_data::YTDL_TARGET, driver::Driver, input::YoutubeDl, Config};
    use reqwest::Client;

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn times_unchanged_while_not_ready() {
        let (t_handle, config) = Config::test_cfg(true);
        let mut driver = Driver::new(config.clone());

        let file = YoutubeDl::new(Client::new(), YTDL_TARGET);
        let handle = driver.play(Track::from(file));

        let state = t_handle
            .ready_track(&handle, Some(Duration::from_millis(5)))
            .await;

        // As state is `play`, the instant we ready we'll have playout.
        // Naturally, fetching a ytdl request takes far longer than this.
        assert_eq!(state.position, Duration::from_millis(20));
        assert_eq!(state.play_time, Duration::from_millis(20));
    }
}
