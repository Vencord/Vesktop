use crate::tracks::{ReadyState, SeekRequest};
use std::result::Result as StdResult;
use symphonia_core::errors::Error as SymphError;

use super::*;

pub struct InternalTrack {
    pub(crate) playing: PlayMode,
    pub(crate) volume: f32,
    pub(crate) input: InputState,
    pub(crate) mix_state: DecodeState,
    pub(crate) position: Duration,
    pub(crate) play_time: Duration,
    pub(crate) commands: Receiver<TrackCommand>,
    pub(crate) loops: LoopState,
    pub(crate) callbacks: Callbacks,
}

impl<'a> InternalTrack {
    pub(crate) fn decompose_track(
        val: TrackContext,
    ) -> (Self, EventStore, TrackState, TrackHandle) {
        let TrackContext {
            handle,
            track,
            receiver,
        } = val;
        let out = InternalTrack {
            playing: track.playing,
            volume: track.volume,
            input: InputState::from(track.input),
            mix_state: DecodeState::default(),
            position: Duration::default(),
            play_time: Duration::default(),
            commands: receiver,
            loops: track.loops,
            callbacks: Callbacks::default(),
        };

        let state = out.state();

        (out, track.events, state, handle)
    }

    pub(crate) fn state(&self) -> TrackState {
        let ready = self.input.ready_state();

        TrackState {
            playing: self.playing.clone(),
            volume: self.volume,
            position: self.position,
            play_time: self.play_time,
            loops: self.loops,
            ready,
        }
    }

    pub(crate) fn view(&'a mut self) -> View<'a> {
        let ready = self.input.ready_state();

        View {
            position: &self.position,
            play_time: &self.play_time,
            volume: &mut self.volume,
            meta: self.input.metadata(),
            ready,
            playing: &mut self.playing,
            loops: &mut self.loops,
        }
    }

    pub(crate) fn process_commands(&mut self, index: usize, ic: &Interconnect) -> Action {
        // Note: disconnection and an empty channel are both valid,
        // and should allow the audio object to keep running as intended.

        // We also need to export a target seek point to the mixer, if known.
        let mut action = Action::default();

        // Note that interconnect failures are not currently errors.
        // In correct operation, the event thread should never panic,
        // but it receiving status updates is secondary do actually
        // doing the work.
        while let Ok(cmd) = self.commands.try_recv() {
            match cmd {
                TrackCommand::Play => {
                    self.playing.change_to(PlayMode::Play);
                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Mode(self.playing.clone()),
                    )));
                },
                TrackCommand::Pause => {
                    self.playing.change_to(PlayMode::Pause);
                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Mode(self.playing.clone()),
                    )));
                },
                TrackCommand::Stop => {
                    self.playing.change_to(PlayMode::Stop);
                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Mode(self.playing.clone()),
                    )));
                },
                TrackCommand::Volume(vol) => {
                    self.volume = vol;
                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Volume(self.volume),
                    )));
                },
                TrackCommand::Seek(req) => action.seek_point = Some(req),
                TrackCommand::AddEvent(evt) => {
                    drop(ic.events.send(EventMessage::AddTrackEvent(index, evt)));
                },
                TrackCommand::Do(func) => {
                    if let Some(indiv_action) = func(self.view()) {
                        action.combine(indiv_action);
                    }

                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Total(self.state()),
                    )));
                },
                TrackCommand::Request(tx) => {
                    drop(tx.send(self.state()));
                },
                TrackCommand::Loop(loops) => {
                    self.loops = loops;
                    drop(ic.events.send(EventMessage::ChangeState(
                        index,
                        TrackStateChange::Loops(self.loops, true),
                    )));
                },
                TrackCommand::MakePlayable(callback) => action.make_playable = Some(callback),
            }
        }

        action
    }

    pub(crate) fn do_loop(&mut self) -> bool {
        match &mut self.loops {
            LoopState::Infinite => true,
            LoopState::Finite(n) =>
                if let Some(new_n) = nonmax::NonMaxU32::new(n.get().wrapping_sub(1)) {
                    *n = new_n;
                    true
                } else {
                    false
                },
        }
    }

    /// Steps playback location forward by one frame.
    pub(crate) fn step_frame(&mut self) {
        self.position += TIMESTEP_LENGTH;
        self.play_time += TIMESTEP_LENGTH;
    }

    pub(crate) fn should_check_input(&self) -> bool {
        self.playing.is_playing() || matches!(self.input, InputState::Preparing(_))
    }

    pub(crate) fn end(&mut self) -> &mut Self {
        self.playing.change_to(PlayMode::End);

        self
    }

    /// Readies the requested input state.
    ///
    /// Returns the usable version of the audio if available, and whether the track should be deleted.
    pub(crate) fn get_or_ready_input(
        &'a mut self,
        id: usize,
        interconnect: &Interconnect,
        pool: &BlockyTaskPool,
        config: &Arc<Config>,
        prevent_events: bool,
    ) -> StdResult<(&'a mut Parsed, &'a mut DecodeState), InputReadyingError> {
        let input = &mut self.input;
        let mix_state = &mut self.mix_state;

        let (out, queued_seek) = match input {
            InputState::NotReady(_) => {
                let (tx, rx) = flume::bounded(1);

                let mut state = InputState::Preparing(PreparingInfo {
                    time: Instant::now(),
                    queued_seek: None,
                    callback: rx,
                });

                std::mem::swap(&mut state, input);

                match state {
                    InputState::NotReady(a @ Input::Lazy(_)) => {
                        pool.create(tx, a, None, config.clone());
                    },
                    InputState::NotReady(Input::Live(audio, rec)) => {
                        pool.parse(config.clone(), tx, audio, rec, None);
                    },
                    _ => unreachable!(),
                }

                if !prevent_events {
                    drop(interconnect.events.send(EventMessage::ChangeState(
                        id,
                        TrackStateChange::Ready(ReadyState::Preparing),
                    )));
                }

                (Err(InputReadyingError::Waiting), None)
            },
            InputState::Preparing(info) => {
                let queued_seek = info.queued_seek.take();

                let orig_out = match info.callback.try_recv() {
                    Ok(MixerInputResultMessage::Built(parsed, rec)) => {
                        *input = InputState::Ready(parsed, rec);
                        mix_state.reset();

                        // possible TODO: set position to the true track position here?
                        // ISSUE: need to get next_packet to see its `ts`, but inner_pos==0
                        // will trigger next packet to be taken at mix time.

                        if !prevent_events {
                            drop(interconnect.events.send(EventMessage::ChangeState(
                                id,
                                TrackStateChange::Ready(ReadyState::Playable),
                            )));
                        }

                        self.callbacks.playable();

                        if let InputState::Ready(ref mut parsed, _) = input {
                            Ok(parsed)
                        } else {
                            unreachable!()
                        }
                    },
                    Ok(MixerInputResultMessage::Seek(parsed, rec, seek_res)) => {
                        match seek_res {
                            Ok(pos) => {
                                if let Some(time_base) = parsed.decoder.codec_params().time_base {
                                    // Update track's position to match the actual timestamp the
                                    // seek landed at.
                                    let new_time = time_base.calc_time(pos.actual_ts);
                                    let time_in_float = new_time.seconds as f64 + new_time.frac;
                                    self.position =
                                        std::time::Duration::from_secs_f64(time_in_float);

                                    self.callbacks.seeked(self.position);
                                    self.callbacks.playable();

                                    if !prevent_events {
                                        drop(interconnect.events.send(EventMessage::ChangeState(
                                            id,
                                            TrackStateChange::Position(self.position),
                                        )));

                                        drop(interconnect.events.send(EventMessage::ChangeState(
                                            id,
                                            TrackStateChange::Ready(ReadyState::Playable),
                                        )));
                                    }

                                    // Our decoder state etc. must be reset.
                                    // (Symphonia decoder state reset in the thread pool during
                                    // the operation.)
                                    mix_state.reset();
                                    *input = InputState::Ready(parsed, rec);

                                    if let InputState::Ready(ref mut parsed, _) = input {
                                        Ok(parsed)
                                    } else {
                                        unreachable!()
                                    }
                                } else {
                                    Err(InputReadyingError::Seeking(
                                        SymphError::Unsupported("Track had no recorded time base.")
                                            .into(),
                                    ))
                                }
                            },
                            Err(e) => Err(InputReadyingError::Seeking(e)),
                        }
                    },
                    Ok(MixerInputResultMessage::CreateErr(e)) =>
                        Err(InputReadyingError::Creation(e)),
                    Ok(MixerInputResultMessage::ParseErr(e)) => Err(InputReadyingError::Parsing(e)),
                    Err(TryRecvError::Disconnected) => Err(InputReadyingError::Dropped),
                    Err(TryRecvError::Empty) => Err(InputReadyingError::Waiting),
                };

                let orig_out = orig_out.map(|a| (a, mix_state));

                if let Err(ref e) = orig_out {
                    if let Some(e) = e.as_user() {
                        self.callbacks.readying_error(e);
                    }
                }

                (orig_out, queued_seek)
            },
            InputState::Ready(ref mut parsed, _) => (Ok((parsed, mix_state)), None),
        };

        match (out, queued_seek) {
            (Ok(_), Some(request)) => Err(InputReadyingError::NeedsSeek(request)),
            (a, _) => a,
        }
    }

    pub(crate) fn seek(
        &mut self,
        id: usize,
        request: SeekRequest,
        interconnect: &Interconnect,
        pool: &BlockyTaskPool,
        config: &Arc<Config>,
        prevent_events: bool,
    ) {
        if let InputState::Preparing(p) = &mut self.input {
            p.queued_seek = Some(request);
            return;
        }

        // might be a little topsy turvy: rethink me.
        let SeekRequest { time, callback } = request;

        self.callbacks.seek = Some(callback);
        if !prevent_events {
            drop(interconnect.events.send(EventMessage::ChangeState(
                id,
                TrackStateChange::Ready(ReadyState::Preparing),
            )));
        }

        let backseek_needed = time < self.position;

        let time = Time::from(time.as_secs_f64());
        let mut ts = SeekTo::Time {
            time,
            track_id: None,
        };
        let (tx, rx) = flume::bounded(1);

        let state = std::mem::replace(
            &mut self.input,
            InputState::Preparing(PreparingInfo {
                time: Instant::now(),
                callback: rx,
                queued_seek: None,
            }),
        );

        match state {
            InputState::Ready(p, r) => {
                if let SeekTo::Time { time: _, track_id } = &mut ts {
                    *track_id = Some(p.track_id);
                }

                pool.seek(tx, p, r, ts, backseek_needed, config.clone());
            },
            InputState::NotReady(lazy) => pool.create(tx, lazy, Some(ts), config.clone()),
            InputState::Preparing(_) => unreachable!(), // Covered above.
        }
    }
}

#[derive(Debug, Default)]
pub struct Callbacks {
    pub seek: Option<Sender<StdResult<Duration, PlayError>>>,
    pub make_playable: Option<Sender<StdResult<(), PlayError>>>,
}

impl Callbacks {
    fn readying_error(&mut self, err: PlayError) {
        if let Some(callback) = self.seek.take() {
            drop(callback.send(Err(err.clone())));
        }

        if let Some(callback) = self.make_playable.take() {
            drop(callback.send(Err(err)));
        }
    }

    fn playable(&mut self) {
        if let Some(callback) = self.make_playable.take() {
            drop(callback.send(Ok(())));
        }
    }

    fn seeked(&mut self, time: Duration) {
        if let Some(callback) = self.seek.take() {
            drop(callback.send(Ok(time)));
        }
    }
}
