#![allow(missing_docs)]

use crate::{
    driver::Driver,
    tracks::{PlayMode, ReadyState, Track},
    Config,
};

use std::time::Duration;

pub async fn track_plays_passthrough<T, F>(make_track: F)
where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    track_plays_base(make_track, true, None).await;
}

pub async fn track_plays_passthrough_when_is_only_active<T, F>(make_track: F)
where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    track_plays_base(
        make_track,
        true,
        Some(include_bytes!("../../resources/loop.wav")),
    )
    .await;
}

pub async fn track_plays_mixed<T, F>(make_track: F)
where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    track_plays_base(make_track, false, None).await;
}

pub async fn track_plays_base<T, F>(
    make_track: F,
    passthrough: bool,
    dummy_track: Option<&'static [u8]>,
) where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    let (t_handle, config) = Config::test_cfg(true);
    let mut driver = Driver::new(config.clone());

    // Used to ensure that paused tracks won't prevent passthrough from happening
    // i.e., most queue users :)
    if let Some(audio_data) = dummy_track {
        driver.play(Track::from(audio_data).pause());
    }

    let file = make_track();

    // Get input in place, playing. Wait for IO to ready.
    t_handle.ready_track(&driver.play(file.into()), None).await;
    t_handle.tick(1);

    // post-conditions:
    // 1) track produces a packet.
    // 2) that packet is passthrough/mixed when we expect them to.
    let pkt = t_handle.recv_async().await;
    let pkt = pkt.raw().unwrap();

    if passthrough {
        assert!(pkt.is_passthrough());
    } else {
        assert!(pkt.is_mixed_with_nonzero_signal());
    }
}

pub async fn forward_seek_correct<T, F>(make_track: F)
where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    let (t_handle, config) = Config::test_cfg(true);
    let mut driver = Driver::new(config.clone());

    let file = make_track();
    let handle = driver.play(file.into());

    // Get input in place, playing. Wait for IO to ready.
    t_handle.ready_track(&handle, None).await;

    let target_time = Duration::from_secs(30);
    assert!(!handle.seek(target_time).is_hung_up());
    t_handle.ready_track(&handle, None).await;

    // post-conditions:
    // 1) track is readied
    // 2) track's position is approx 30s
    // 3) track's play time is considerably less (O(5s))
    let state = handle.get_info();
    t_handle.spawn_ticker();
    let state = state.await.expect("Should have received valid state.");

    assert_eq!(state.ready, ReadyState::Playable);
    assert_eq!(state.playing, PlayMode::Play);
    assert!(state.play_time < Duration::from_secs(5));
    assert!(
        state.position < target_time + Duration::from_millis(100)
            && state.position > target_time - Duration::from_millis(100)
    );
}

pub async fn backward_seek_correct<T, F>(make_track: F)
where
    T: Into<Track>,
    F: FnOnce() -> T,
{
    let (t_handle, config) = Config::test_cfg(true);
    let mut driver = Driver::new(config.clone());

    let file = make_track();
    let handle = driver.play(file.into());

    // Get input in place, playing. Wait for IO to ready.
    t_handle.ready_track(&handle, None).await;

    // Accelerated playout -- 4 seconds worth.
    let n_secs = 4;
    let n_ticks = 50 * n_secs;
    t_handle.skip(n_ticks).await;

    let target_time = Duration::from_secs(1);
    assert!(!handle.seek(target_time).is_hung_up());
    t_handle.ready_track(&handle, None).await;

    // post-conditions:
    // 1) track is readied
    // 2) track's position is approx 1s
    // 3) track's play time is preserved (About 4s)
    let state = handle.get_info();
    t_handle.spawn_ticker();
    let state = state.await.expect("Should have received valid state.");

    assert_eq!(state.ready, ReadyState::Playable);
    assert_eq!(state.playing, PlayMode::Play);
    assert!(state.play_time >= Duration::from_secs(n_secs));
    assert!(
        state.position < target_time + Duration::from_millis(100)
            && state.position > target_time - Duration::from_millis(100)
    );
}
