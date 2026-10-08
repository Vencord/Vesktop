pub mod mix_logic;
mod pool;
mod result;
pub mod state;
pub mod track;
mod util;

use pool::*;
use result::*;
use state::*;
pub use track::*;

use super::{
    disposal::DisposalThread,
    error::{Error, Result},
    message::*,
};
use crate::{
    constants::*,
    driver::{CryptoMode, MixMode},
    events::EventStore,
    input::{Input, Parsed},
    tracks::{Action, LoopState, PlayError, PlayMode, TrackCommand, TrackHandle, TrackState, View},
    Config,
};
use discortp::{
    discord::MutableKeepalivePacket,
    rtp::{MutableRtpPacket, RtpPacket},
    MutablePacket,
};
use flume::{Receiver, SendError, Sender, TryRecvError};
use opus2::{Application as CodingMode, Bitrate, Encoder as OpusEncoder, SoftClip};
use rand::random;
use rubato::{FftFixedOut, Resampler};
use std::{
    io::Write,
    result::Result as StdResult,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use symphonia_core::{
    audio::{AudioBuffer, AudioBufferRef, Layout, SampleBuffer, Signal, SignalSpec},
    codecs::CODEC_TYPE_OPUS,
    conv::IntoSample,
    formats::SeekTo,
    sample::Sample,
    units::Time,
};
use tokio::runtime::Handle;
use tracing::error;

#[cfg(test)]
use crate::driver::test_config::{OutputMessage, OutputMode};
#[cfg(test)]
use discortp::Packet as _;

pub struct Mixer {
    pub bitrate: Bitrate,
    pub config: Arc<Config>,
    pub conn_active: Option<MixerConnection>,
    pub deadline: Instant,
    pub disposer: DisposalThread,
    pub encoder: OpusEncoder,
    pub interconnect: Interconnect,
    pub mix_rx: Receiver<MixerMessage>,
    pub muted: bool,
    // pub packet: [u8; VOICE_PACKET_MAX],
    pub prevent_events: bool,
    pub silence_frames: u8,
    pub soft_clip: SoftClip,
    thread_pool: BlockyTaskPool,
    pub ws: Option<Sender<WsMessage>>,

    pub keepalive_deadline: Instant,
    pub keepalive_packet: [u8; MutableKeepalivePacket::minimum_packet_size()],

    pub tracks: Vec<InternalTrack>,
    track_handles: Vec<TrackHandle>,

    sample_buffer: SampleBuffer<f32>,
    symph_mix: AudioBuffer<f32>,
    resample_scratch: AudioBuffer<f32>,

    #[cfg(test)]
    pub remaining_loops: Option<u64>,

    #[cfg(test)]
    raw_msg: Option<OutputMessage>,
}

fn new_encoder(bitrate: Bitrate, mix_mode: MixMode) -> Result<OpusEncoder> {
    let mut encoder = OpusEncoder::new(SAMPLE_RATE, mix_mode.to_opus(), CodingMode::Audio)?;
    encoder.set_bitrate(bitrate)?;

    Ok(encoder)
}

impl Mixer {
    #[must_use]
    pub fn new(
        mix_rx: Receiver<MixerMessage>,
        async_handle: Handle,
        interconnect: Interconnect,
        config: Config,
    ) -> Self {
        let bitrate = DEFAULT_BITRATE;
        let encoder = new_encoder(bitrate, config.mix_mode)
            .expect("Failed to create encoder in mixing thread with known-good values.");
        let soft_clip = SoftClip::new(config.mix_mode.to_opus());

        let keepalive_packet = [0u8; MutableKeepalivePacket::minimum_packet_size()];

        let tracks = Vec::with_capacity(usize::from(1.max(config.preallocated_tracks)));
        let track_handles = Vec::with_capacity(usize::from(1.max(config.preallocated_tracks)));

        let thread_pool = BlockyTaskPool::new(async_handle);

        let symph_layout = config.mix_mode.symph_layout();

        let disposer = config.disposer.clone().unwrap_or_default();
        let config = config.into();

        let sample_buffer = SampleBuffer::<f32>::new(
            MONO_FRAME_SIZE as u64,
            symphonia_core::audio::SignalSpec::new_with_layout(
                SAMPLE_RATE_RAW as u32,
                symph_layout,
            ),
        );
        let symph_mix = AudioBuffer::<f32>::new(
            MONO_FRAME_SIZE as u64,
            symphonia_core::audio::SignalSpec::new_with_layout(
                SAMPLE_RATE_RAW as u32,
                symph_layout,
            ),
        );
        let resample_scratch = AudioBuffer::<f32>::new(
            MONO_FRAME_SIZE as u64,
            SignalSpec::new_with_layout(SAMPLE_RATE_RAW as u32, Layout::Stereo),
        );

        let deadline = Instant::now();

        Self {
            bitrate,
            config,
            conn_active: None,
            deadline,
            disposer,
            encoder,
            interconnect,
            mix_rx,
            muted: false,
            prevent_events: false,
            silence_frames: 0,
            soft_clip,
            thread_pool,
            ws: None,

            keepalive_deadline: deadline,
            keepalive_packet,

            tracks,
            track_handles,

            sample_buffer,
            symph_mix,
            resample_scratch,

            #[cfg(test)]
            remaining_loops: None,
            #[cfg(test)]
            raw_msg: None,
        }
    }

    fn set_bitrate(&mut self, bitrate: Bitrate) -> Result<()> {
        self.encoder.set_bitrate(bitrate).map_err(Into::into)
    }

    pub(crate) fn do_rebuilds(
        &mut self,
        event_failure: bool,
        conn_failure: bool,
    ) -> StdResult<(), SendError<CoreMessage>> {
        // event failure? rebuild interconnect.
        // ws or udp failure? full connect
        // (soft reconnect is covered by the ws task.)
        //
        // in both cases, send failure is fatal,
        // but will only occur on disconnect.
        if event_failure {
            self.rebuild_interconnect()?;
        }

        if conn_failure {
            self.full_reconnect_gateway()?;
        }

        Ok(())
    }

    pub(crate) fn rebuild_interconnect(&mut self) -> StdResult<(), SendError<CoreMessage>> {
        self.prevent_events = true;
        self.interconnect
            .core
            .send(CoreMessage::RebuildInterconnect)
    }

    pub(crate) fn full_reconnect_gateway(&mut self) -> StdResult<(), SendError<CoreMessage>> {
        self.conn_active = None;
        self.interconnect.core.send(CoreMessage::FullReconnect)
    }

    #[inline]
    pub(crate) fn handle_message(
        &mut self,
        msg: MixerMessage,
        packet: &mut [u8],
    ) -> (bool, bool, bool) {
        let mut events_failure = false;
        let mut conn_failure = false;
        let mut should_exit = false;

        let error = match msg {
            MixerMessage::AddTrack(t) => self.add_track(*t),
            MixerMessage::SetTrack(t) => {
                self.tracks.clear();
                self.track_handles.clear();

                let mut out = self.fire_event(EventMessage::RemoveAllTracks);

                if let Some(t) = t {
                    // Do this unconditionally: this affects local state infallibly,
                    // with the event installation being the remote part.
                    if let Err(e) = self.add_track(*t) {
                        out = Err(e);
                    }
                }

                out
            },
            MixerMessage::SetBitrate(b) => {
                self.bitrate = b;
                if let Err(e) = self.set_bitrate(b) {
                    error!("Failed to update bitrate {:?}", e);
                }
                Ok(())
            },
            MixerMessage::SetMute(m) => {
                self.muted = m;
                Ok(())
            },
            MixerMessage::SetConn(conn, ssrc) => {
                self.conn_active = Some(conn);
                let mut rtp = MutableRtpPacket::new(packet).expect(
                    "Too few bytes in self.packet for RTP header.\
                        (Blame: VOICE_PACKET_MAX?)",
                );
                rtp.set_ssrc(ssrc);
                rtp.set_sequence(random::<u16>().into());
                rtp.set_timestamp(random::<u32>().into());
                self.deadline = Instant::now();

                self.update_keepalive(ssrc);
                Ok(())
            },
            MixerMessage::DropConn => {
                self.conn_active = None;
                Ok(())
            },
            MixerMessage::ReplaceInterconnect(i) => {
                self.prevent_events = false;

                if let Some(ws) = &self.ws {
                    conn_failure |= ws.send(WsMessage::ReplaceInterconnect(i.clone())).is_err();
                }

                #[cfg(feature = "receive")]
                if let Some(conn) = &self.conn_active {
                    conn_failure |= conn
                        .udp_rx
                        .send(UdpRxMessage::ReplaceInterconnect(i.clone()))
                        .is_err();
                }

                self.interconnect = i;

                self.rebuild_tracks()
            },
            MixerMessage::SetConfig(new_config) => {
                if new_config.mix_mode != self.config.mix_mode {
                    self.soft_clip = SoftClip::new(new_config.mix_mode.to_opus());
                    if let Ok(enc) = new_encoder(self.bitrate, new_config.mix_mode) {
                        self.encoder = enc;
                    } else {
                        self.bitrate = DEFAULT_BITRATE;
                        self.encoder = new_encoder(self.bitrate, new_config.mix_mode)
                            .expect("Failed fallback rebuild of OpusEncoder with safe inputs.");
                    }

                    let sl = new_config.mix_mode.symph_layout();
                    self.sample_buffer = SampleBuffer::<f32>::new(
                        MONO_FRAME_SIZE as u64,
                        SignalSpec::new_with_layout(SAMPLE_RATE_RAW as u32, sl),
                    );
                    self.symph_mix = AudioBuffer::<f32>::new(
                        MONO_FRAME_SIZE as u64,
                        SignalSpec::new_with_layout(SAMPLE_RATE_RAW as u32, sl),
                    );
                }

                self.config = Arc::new(
                    #[cfg(feature = "receive")]
                    new_config.clone(),
                    #[cfg(not(feature = "receive"))]
                    new_config,
                );

                let preallocated_tracks = usize::from(self.config.preallocated_tracks);
                if self.tracks.capacity() < preallocated_tracks {
                    self.tracks.reserve(preallocated_tracks - self.tracks.len());
                }

                #[cfg(feature = "receive")]
                if let Some(conn) = &self.conn_active {
                    if let crate::driver::DecodeMode::Decode(decode_config) = new_config.decode_mode
                    {
                        let msg = UdpRxMessage::SetConfig(decode_config);
                        conn_failure |= conn.udp_rx.send(msg).is_err();
                    }
                }

                Ok(())
            },
            MixerMessage::RebuildEncoder => match new_encoder(self.bitrate, self.config.mix_mode) {
                Ok(encoder) => {
                    self.encoder = encoder;
                    Ok(())
                },
                Err(e) => {
                    error!("Failed to rebuild encoder. Resetting bitrate. {:?}", e);
                    self.bitrate = DEFAULT_BITRATE;
                    self.encoder = new_encoder(self.bitrate, self.config.mix_mode)
                        .expect("Failed fallback rebuild of OpusEncoder with safe inputs.");
                    Ok(())
                },
            },
            MixerMessage::Ws(new_ws_handle) => {
                self.ws = new_ws_handle;
                if let Err(e) = self.send_gateway_speaking() {
                    conn_failure |= e.should_trigger_connect();
                }
                Ok(())
            },
            MixerMessage::Poison => {
                should_exit = true;
                Ok(())
            },
        };

        if let Err(e) = error {
            events_failure |= e.should_trigger_interconnect_rebuild();
            conn_failure |= e.should_trigger_connect();
        }

        (events_failure, conn_failure, should_exit)
    }

    pub(crate) fn update_keepalive(&mut self, ssrc: u32) {
        let mut ka = MutableKeepalivePacket::new(&mut self.keepalive_packet[..])
            .expect("FATAL: Insufficient bytes given to keepalive packet.");
        ka.set_ssrc(ssrc);
        self.keepalive_deadline = self.deadline + UDP_KEEPALIVE_GAP;
    }

    #[inline]
    pub(crate) fn fire_event(&self, event: EventMessage) -> Result<()> {
        // As this task is responsible for noticing the potential death of an event context,
        // it's responsible for not forcibly recreating said context repeatedly.
        if !self.prevent_events {
            self.interconnect.events.send(event)?;
        }

        Ok(())
    }

    #[inline]
    pub fn add_track(&mut self, track: TrackContext) -> Result<()> {
        let (track, evts, state, handle) = InternalTrack::decompose_track(track);
        self.tracks.push(track);
        self.track_handles.push(handle.clone());
        self.interconnect
            .events
            .send(EventMessage::AddTrack(evts, state, handle))?;

        Ok(())
    }

    // rebuilds the event thread's view of each track, in event of a full rebuild.
    #[inline]
    fn rebuild_tracks(&mut self) -> Result<()> {
        for (track, handle) in self.tracks.iter().zip(self.track_handles.iter()) {
            let evts = EventStore::default();
            let state = track.state();
            let handle = handle.clone();

            self.interconnect
                .events
                .send(EventMessage::AddTrack(evts, state, handle))?;
        }

        Ok(())
    }

    #[inline]
    pub(crate) fn audio_commands_events(&mut self) -> Result<()> {
        // Apply user commands.
        for (i, track) in self.tracks.iter_mut().enumerate() {
            // This causes fallible event system changes,
            // but if the event thread has died then we'll certainly
            // detect that on the tick later.
            // Changes to play state etc. MUST all be handled.
            let action = track.process_commands(i, &self.interconnect);

            if let Some(req) = action.seek_point {
                track.seek(
                    i,
                    req,
                    &self.interconnect,
                    &self.thread_pool,
                    &self.config,
                    self.prevent_events,
                );
            }

            if let Some(callback) = action.make_playable {
                if let Err(e) = track.get_or_ready_input(
                    i,
                    &self.interconnect,
                    &self.thread_pool,
                    &self.config,
                    self.prevent_events,
                ) {
                    track.callbacks.make_playable = Some(callback);
                    if let Some(fail) = e.as_user() {
                        track.playing = PlayMode::Errored(fail);
                    }
                    if let Some(req) = e.into_seek_request() {
                        track.seek(
                            i,
                            req,
                            &self.interconnect,
                            &self.thread_pool,
                            &self.config,
                            self.prevent_events,
                        );
                    }
                } else {
                    // Track is already ready: don't register callback and just act.
                    drop(callback.send(Ok(())));
                }
            }
        }

        let mut i = 0;
        while i < self.tracks.len() {
            let track = self
                .tracks
                .get_mut(i)
                .expect("Tried to remove an illegal track index.");

            if track.playing.is_done() {
                let p_state = track.playing.clone();
                let to_drop = self.tracks.swap_remove(i);
                self.disposer
                    .dispose(DisposalMessage::Track(Box::new(to_drop)));

                let to_drop = self.track_handles.swap_remove(i);
                self.disposer.dispose(DisposalMessage::Handle(to_drop));

                self.fire_event(EventMessage::ChangeState(
                    i,
                    TrackStateChange::Mode(p_state),
                ))?;
            } else {
                i += 1;
            }
        }

        // Tick -- receive side also handles removals in same manner after it increments
        // times etc.
        self.fire_event(EventMessage::Tick)?;

        Ok(())
    }

    #[cfg(test)]
    #[inline]
    pub(crate) fn test_signal_empty_tick(&self) {
        match &self.config.override_connection {
            Some(OutputMode::Raw(tx)) =>
                drop(tx.send(crate::driver::test_config::TickMessage::NoEl)),
            Some(OutputMode::Rtp(tx)) =>
                drop(tx.send(crate::driver::test_config::TickMessage::NoEl)),
            None => {},
        }
    }

    pub fn crypto_mode(&self) -> CryptoMode {
        let mode = self.conn_active.as_ref().map(|v| v.crypto_state.kind());
        if cfg!(not(test)) {
            mode.expect("Shouldn't be mixing packets without access to a cipher + UDP dest.")
        } else {
            mode.unwrap_or_else(|| self.config.crypto_mode)
        }
    }

    #[inline]
    pub fn mix_and_build_packet(&mut self, packet: &mut [u8]) -> Result<usize> {
        // symph_mix is an `AudioBuffer` (planar format), we need to convert this
        // later into an interleaved `SampleBuffer` for libopus.
        self.symph_mix.clear();
        self.symph_mix.render_reserved(Some(MONO_FRAME_SIZE));
        self.resample_scratch.clear();

        // Walk over all the audio files, combining into one audio frame according
        // to volume, play state, etc.
        let mut mix_len = {
            let out = self.mix_tracks(packet);

            self.sample_buffer.copy_interleaved_typed(&self.symph_mix);

            out
        };

        if self.muted {
            mix_len = MixType::MixedPcm(0);
        }

        // Explicit "Silence" frame handling: if there is no mixed data, we must send
        // ~5 frames of silence (unless another good audio frame appears) before we
        // stop sending RTP frames.
        if mix_len == MixType::MixedPcm(0) {
            if self.silence_frames > 0 {
                self.silence_frames -= 1;
                let mut rtp = MutableRtpPacket::new(packet).expect(
                    "FATAL: Too few bytes in self.packet for RTP header.\
                        (Blame: VOICE_PACKET_MAX?)",
                );

                let payload = rtp.payload_mut();
                let pre_len = self.crypto_mode().payload_prefix_len();

                payload[pre_len..pre_len + SILENT_FRAME.len()].copy_from_slice(&SILENT_FRAME[..]);

                mix_len = MixType::Passthrough(SILENT_FRAME.len());
            } else {
                // Per official guidelines, send 5x silence BEFORE we stop speaking.
                return Ok(0);
            }
        } else {
            self.silence_frames = 5;

            if let MixType::MixedPcm(n) = mix_len {
                if self.config.use_softclip {
                    self.soft_clip.apply(
                        &mut self.sample_buffer.samples_mut()
                            [..n * self.config.mix_mode.channels()],
                    );
                }
            }
        }

        // For the benefit of test cases, send the raw un-RTP'd data.
        #[cfg(test)]
        let out = if let Some(OutputMode::Raw(_)) = &self.config.override_connection {
            // This case has been handled before buffer clearing above.
            let msg = match mix_len {
                MixType::Passthrough(len) if len == SILENT_FRAME.len() => OutputMessage::Silent,
                MixType::Passthrough(len) => {
                    let rtp = RtpPacket::new(packet).expect(
                        "FATAL: Too few bytes in self.packet for RTP header.\
                            (Blame: VOICE_PACKET_MAX?)",
                    );
                    let payload = rtp.payload();
                    let opus_frame =
                        (payload[self.crypto_mode().payload_prefix_len()..][..len]).to_vec();

                    OutputMessage::Passthrough(opus_frame)
                },
                MixType::MixedPcm(_) => OutputMessage::Mixed(
                    self.sample_buffer.samples()[..self.config.mix_mode.sample_count_in_frame()]
                        .to_vec(),
                ),
            };

            self.raw_msg = Some(msg);

            Ok(1)
        } else {
            self.prep_packet(mix_len, packet)
        };

        #[cfg(not(test))]
        let out = self.prep_packet(mix_len, packet);

        // Zero out all planes of the mix buffer if any audio was written.
        if matches!(mix_len, MixType::MixedPcm(a) if a > 0) {
            for plane in self.symph_mix.planes_mut().planes() {
                plane.fill(0.0);
            }
        }

        out
    }

    #[inline]
    fn prep_packet(&mut self, mix_len: MixType, packet: &mut [u8]) -> Result<usize> {
        let send_buffer = self.sample_buffer.samples();

        let conn = self
            .conn_active
            .as_mut()
            .expect("Shouldn't be mixing packets without access to a cipher + UDP dest.");

        let mut rtp = MutableRtpPacket::new(packet).expect(
            "FATAL: Too few bytes in self.packet for RTP header.\
                (Blame: VOICE_PACKET_MAX?)",
        );

        let payload = rtp.payload_mut();
        let crypto_mode = conn.crypto_state.kind();
        let first_payload_byte = crypto_mode.payload_prefix_len();
        let total_payload_space = payload.len() - crypto_mode.payload_suffix_len();

        // If passthrough, Opus payload in place already.
        // Else encode into buffer with space for AEAD encryption headers.
        let mut payload_len = match mix_len {
            MixType::Passthrough(opus_len) => opus_len,
            MixType::MixedPcm(_samples) => self.encoder.encode_float(
                &send_buffer[..self.config.mix_mode.sample_count_in_frame()],
                &mut payload[first_payload_byte..total_payload_space],
            )?,
        };

        if conn.dave_protocol_version.load(Ordering::Relaxed) != 0 {
            if let Some(ref mut dave_session) = *conn.dave_session.write().unwrap() {
                if dave_session.is_ready() {
                    let encrypted = dave_session
                        .encrypt_opus(
                            &payload[first_payload_byte..first_payload_byte + payload_len],
                        )?
                        .into_owned();
                    payload_len = encrypted.len();

                    payload[first_payload_byte..first_payload_byte + payload_len]
                        .copy_from_slice(&encrypted);
                }
            }
        }

        let final_payload_size = conn
            .crypto_state
            .write_packet_nonce(&mut rtp, first_payload_byte + payload_len);

        // Packet encryption ignored in test modes.
        #[cfg(not(test))]
        let encrypt = true;
        #[cfg(test)]
        let encrypt = self.config.override_connection.is_none();

        if encrypt {
            conn.cipher
                .encrypt_pkt_in_place(&mut rtp, final_payload_size)?;
        }

        Ok(RtpPacket::minimum_packet_size() + final_payload_size)
    }

    #[inline]
    pub(crate) fn send_packet(&self, packet: &[u8]) -> Result<()> {
        #[cfg(test)]
        let send_status = if let Some(OutputMode::Raw(tx)) = &self.config.override_connection {
            // This case has been handled before buffer clearing in `mix_and_build_packet`.
            drop(tx.send(self.raw_msg.clone().unwrap().into()));

            Ok(())
        } else {
            self.send_packet_(packet)
        };

        #[cfg(not(test))]
        let send_status = self.send_packet_(packet);

        send_status.or_else(Error::disarm_would_block)?;

        Ok(())
    }

    #[inline]
    fn send_packet_(&self, packet: &[u8]) -> Result<()> {
        let conn = self
            .conn_active
            .as_ref()
            .expect("Shouldn't be mixing packets without access to a cipher + UDP dest.");

        #[cfg(test)]
        if let Some(OutputMode::Rtp(tx)) = &self.config.override_connection {
            // Test mode: send unencrypted (compressed) packets to local receiver.
            drop(tx.send(packet.to_vec().into()));
        } else {
            conn.udp_tx.send(packet)?;
        }

        #[cfg(not(test))]
        {
            // Normal operation: send encrypted payload to UDP Tx task.
            conn.udp_tx.send(packet)?;
        }

        Ok(())
    }

    #[inline]
    pub(crate) fn check_and_send_keepalive(&mut self, now: Option<Instant>) -> Result<()> {
        if let Some(conn) = self.conn_active.as_mut() {
            let now = now.unwrap_or_else(Instant::now);
            if now >= self.keepalive_deadline {
                conn.udp_tx.send(&self.keepalive_packet)?;
                self.keepalive_deadline += UDP_KEEPALIVE_GAP;
            }
        }

        Ok(())
    }

    #[inline]
    pub(crate) fn send_gateway_speaking(&self) -> Result<()> {
        if let Some(ws) = &self.ws {
            ws.send(WsMessage::Speaking(true))?;
        }

        Ok(())
    }

    #[inline]
    pub(crate) fn send_gateway_not_speaking(&self) {
        if let Some(ws) = &self.ws {
            // NOTE: this explicit `drop` should prevent a catastrophic thread pileup.
            // A full reconnect might cause an inner closed connection.
            // It's safer to leave the central task to clean this up and
            // pass the mixer a new channel.
            drop(ws.send(WsMessage::Speaking(false)));
        }
    }

    #[inline]
    fn mix_tracks(&mut self, packet: &mut [u8]) -> MixType {
        // Get a slice of bytes to write in data for Opus packet passthrough.
        let mut rtp = MutableRtpPacket::new(packet).expect(
            "FATAL: Too few bytes in self.packet for RTP header.\
                (Blame: VOICE_PACKET_MAX?)",
        );
        let payload = rtp.payload_mut();
        let opus_frame = &mut payload[self.crypto_mode().payload_prefix_len()..];

        // Opus frame passthrough.
        // This requires that we have only one PLAYING track, who has volume 1.0, and an
        // Opus codec type (verified later in mix_symph_indiv).
        //
        // We *could* cache the number of live tracks separately, but that makes this
        // quite fragile given all the ways a user can alter the PlayMode.
        let mut num_live = 0;
        let mut last_live_vol = 1.0;
        for track in &self.tracks {
            if track.playing.is_playing() {
                num_live += 1;
                last_live_vol = track.volume;
            }
        }
        let do_passthrough = num_live == 1 && (last_live_vol - 1.0).abs() < f32::EPSILON;

        let mut len = 0;
        for (i, track) in self.tracks.iter_mut().enumerate() {
            let vol = track.volume;

            // This specifically tries to get tracks who are "preparing",
            // so that event handlers and the like can all be fired without
            // the track being in a `Play` state.
            if !track.should_check_input() {
                continue;
            }

            let should_play = track.playing.is_playing();

            let input = track.get_or_ready_input(
                i,
                &self.interconnect,
                &self.thread_pool,
                &self.config,
                self.prevent_events,
            );

            let (input, mix_state) = match input {
                Ok(i) => i,
                Err(InputReadyingError::Waiting) => continue,
                Err(InputReadyingError::NeedsSeek(req)) => {
                    track.seek(
                        i,
                        req,
                        &self.interconnect,
                        &self.thread_pool,
                        &self.config,
                        self.prevent_events,
                    );
                    continue;
                },
                // TODO: allow for retry in given time.
                Err(e) => {
                    if let Some(fail) = e.as_user() {
                        track.playing = PlayMode::Errored(fail);
                    }
                    continue;
                },
            };

            // Now that we have dealt with potential errors in preparing tracks,
            // only do any mixing if the track is to be played!
            if !should_play {
                continue;
            }

            let (mix_type, status) = mix_logic::mix_symph_indiv(
                &mut self.symph_mix,
                &mut self.resample_scratch,
                input,
                mix_state,
                vol,
                do_passthrough.then_some(&mut *opus_frame),
            );

            let return_here = if let MixType::MixedPcm(pcm_len) = mix_type {
                len = len.max(pcm_len);
                false
            } else {
                if mix_state.passthrough == Passthrough::Inactive {
                    input.decoder.reset();
                }
                mix_state.passthrough = Passthrough::Active;
                true
            };

            // FIXME: allow Ended to trigger a seek/loop/revisit in the same mix cycle?
            // Would this be possible with special-casing to mark some inputs as fast
            // to recreate? Probably not doable in the general case.
            match status {
                MixStatus::Live => track.step_frame(),
                MixStatus::Errored(e) =>
                    track.playing = PlayMode::Errored(PlayError::Decode(e.into())),
                MixStatus::Ended if track.do_loop() => {
                    drop(self.track_handles[i].seek(Duration::default()));
                    if !self.prevent_events {
                        // position update is sent out later, when the seek concludes.
                        drop(self.interconnect.events.send(EventMessage::ChangeState(
                            i,
                            TrackStateChange::Loops(track.loops, false),
                        )));
                    }
                },
                MixStatus::Ended => {
                    track.end();
                },
            }

            // This needs to happen here due to borrow checker shenanigans.
            if return_here {
                return mix_type;
            }
        }

        MixType::MixedPcm(len)
    }
}
