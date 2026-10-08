//! Voice: the songbird driver lifecycle, following Acheron's model
//! (docs/VOICE.md). A user account holds a single voice connection, so one
//! task owns one [`Driver`] and rebuilds it from the payloads Discord's
//! gateway hands out after op 4: our VOICE_STATE_UPDATE (session id) and
//! VOICE_SERVER_UPDATE (endpoint + token). The driver handles the voice
//! websocket, UDP and the DAVE handshake on its own.
//!
//! Phases 2-4 live here too: received audio is decoded (`DecodeMode::Decode`)
//! and mixed into a cpal ring by a global event handler; the microphone is
//! captured by `super::audio` and fed to the driver as a live `RawAdapter`;
//! mute/deafen, per-user volume and device/sensitivity settings round it off.

use std::collections::{HashMap, HashSet};
use std::num::NonZeroU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use songbird::driver::{DecodeConfig, DecodeMode, MixMode};
use songbird::events::{CoreEvent, Event, EventContext, EventHandler};
use songbird::id::{ChannelId, GuildId, UserId};
use songbird::input::RawAdapter;
use songbird::{Config, ConnectionInfo, Driver};
use tokio::sync::mpsc::UnboundedReceiver;

use super::audio::{self, AudioLinks, Capture, MicSource, Ring, VOICE_RATE};
use crate::backend::events::{EventTx, UiEvent};
use crate::model::VoiceState;

/// How long Discord has to answer op 4 before the join attempt fails.
const JOIN_TIMEOUT: Duration = Duration::from_secs(10);

/// Per-tick mix size: 20 ms of stereo at 48 kHz.
const TICK_SAMPLES: usize = 2 * VOICE_RATE as usize / 50;

/// Requests from the UI thread to the voice task.
#[derive(Debug, Clone)]
pub enum VoiceCommand {
    Join {
        guild_id: String,
        channel_id: String,
        user_id: String,
    },
    Leave,
    SetMute {
        muted: bool,
    },
    SetDeaf {
        deafened: bool,
    },
    SetUserVolume {
        user_id: String,
        volume: f32,
    },
    ApplyConfig {
        input_device: Option<String>,
        output_device: Option<String>,
        sensitivity: u8,
        noise_suppression: bool,
    },
    /// The channel's member ids from the main gateway, for the DAVE MLS
    /// group (user accounts get no op 11 from the voice server).
    SetRoster(Vec<u64>),
}

/// Voice-gateway payloads the main gateway task forwards here. `Server`
/// carries the gateway session id from READY: Discord does not send user
/// accounts their own VOICE_STATE_UPDATE, so that's where the handshake's
/// session id comes from.
#[derive(Debug, Clone)]
pub enum Wire {
    State(VoiceState),
    Server {
        guild_id: String,
        endpoint: String,
        token: String,
        session_id: String,
    },
}

/// Everything the audio path can tweak from the settings window.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AudioConfig {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub sensitivity: u8,
    pub noise_suppression: bool,
}

/// State shared between the driver's event handlers and the task loop.
struct Shared {
    ssrc_map: Arc<Mutex<HashMap<u32, String>>>,
    volumes: Mutex<HashMap<String, f32>>,
    deafened: AtomicBool,
    self_muted: AtomicBool,
    output_ring: Mutex<Option<Arc<Ring>>>,
    capture: Arc<Mutex<Capture>>,
    /// Channel roster (user ids) from the main gateway; re-seeded into the
    /// driver after every connect so the MLS group knows all members.
    roster: Mutex<Vec<u64>>,
    /// Already asked for a desync rejoin since the last successful mapping.
    desync_reported: AtomicBool,
}

impl Default for Shared {
    fn default() -> Self {
        Self {
            ssrc_map: Arc::new(Mutex::new(HashMap::new())),
            volumes: Mutex::new(HashMap::new()),
            deafened: AtomicBool::new(false),
            self_muted: AtomicBool::new(false),
            output_ring: Mutex::new(None),
            capture: Arc::new(Mutex::new(Capture::new(0, false, Ring::detached()))),
            roster: Mutex::new(Vec::new()),
            desync_reported: AtomicBool::new(false),
        }
    }
}

/// A join attempt waiting for Discord's state and server updates.
struct Pending {
    guild_id: String,
    channel_id: String,
    user_id: String,
    session_id: Option<String>,
    endpoint: Option<String>,
    token: Option<String>,
    since: Instant,
}

impl Pending {
    fn new(guild_id: String, channel_id: String, user_id: String) -> Self {
        Self {
            guild_id,
            channel_id,
            user_id,
            session_id: None,
            endpoint: None,
            token: None,
            since: Instant::now(),
        }
    }

    fn apply_state(&mut self, state: &VoiceState) {
        if let Some(channel_id) = &state.channel_id {
            self.channel_id = channel_id.clone();
        }
        self.session_id = Some(state.session_id.clone());
    }

    fn info(&self) -> Option<ConnectionInfo> {
        let guild_id: NonZeroU64 = self.guild_id.parse().ok()?;
        let channel_id: NonZeroU64 = self.channel_id.parse().ok()?;
        let user_id: NonZeroU64 = self.user_id.parse().ok()?;
        Some(ConnectionInfo {
            channel_id: ChannelId(channel_id),
            endpoint: self.endpoint.clone()?,
            guild_id: GuildId(guild_id),
            session_id: self.session_id.clone()?,
            token: self.token.clone()?,
            user_id: UserId(user_id),
        })
    }
}

enum Conn {
    Idle,
    Pending(Pending),
    /// The driver is connected; `since` is set when the user asked for a
    /// channel move, to revert the UI if Discord never confirms it.
    Live {
        info: Box<ConnectionInfo>,
        since: Option<Instant>,
    },
}

/// Mixes each 20 ms `VoiceTick` (per-user decoded PCM) into the playback
/// ring, scaled by per-user volume, and diffs the speaking set into
/// `UiEvent::VoiceSpeaking` for the green indicators.
struct TickMixer {
    shared: Arc<Shared>,
    event_tx: EventTx,
    speaking: Mutex<HashSet<u32>>,
    dump: Mutex<Vec<f32>>,
    dump_samples: std::sync::atomic::AtomicUsize,
    last_log: Mutex<Instant>,
    /// When an unmapped SSRC started (and whether we already reported it):
    /// its audio cannot be attributed or decrypted, and after a few seconds
    /// the session is provably out of sync (docs/VOICE.md).
    unmapped_since: Mutex<Option<(Instant, bool)>>,
}

#[async_trait]
impl EventHandler for TickMixer {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        let EventContext::VoiceTick(tick) = ctx else {
            return None;
        };
        let map = self.shared.ssrc_map.lock().unwrap();
        let deafened = self.shared.deafened.load(Ordering::Relaxed);
        if !deafened && !tick.speaking.is_empty() {
            let mut mix: Vec<f32> = Vec::with_capacity(TICK_SAMPLES);
            let volumes = self.shared.volumes.lock().unwrap();
            for (ssrc, data) in &tick.speaking {
                let Some(user) = map.get(ssrc) else {
                    continue;
                };
                let Some(pcm) = data.decoded_voice.as_deref() else {
                    continue;
                };
                if pcm.is_empty() {
                    continue;
                }
                let volume = volumes.get(user).copied().unwrap_or(1.0);
                // Decoders default to stereo; short buffers are mono.
                let channels = if pcm.len() > TICK_SAMPLES / 2 { 2 } else { 1 };
                if mix.len() < TICK_SAMPLES {
                    mix.resize(TICK_SAMPLES, 0.0);
                }
                for (frame, chunk) in pcm.chunks(channels).enumerate() {
                    let left = f32::from(chunk[0]) / 32768.0 * volume;
                    // Mono sources play centered.
                    let right = chunk
                        .get(1)
                        .map_or(left, |sample| f32::from(*sample) / 32768.0 * volume);
                    if let Some(slot) = mix.get_mut(frame * 2) {
                        *slot += left;
                    }
                    if let Some(slot) = mix.get_mut(frame * 2 + 1) {
                        *slot += right;
                    }
                }
            }
            // Diagnostic capture: first 10 s of the post-decrypt mix.
            if self.dump_samples.load(Ordering::Relaxed) < 48_000 * 10 {
                let mut dump = self.dump.lock().unwrap();
                dump.extend_from_slice(&mix);
                drop(dump);
                let total = self.dump_samples.fetch_add(mix.len(), Ordering::SeqCst) + mix.len();
                if total >= 48_000 * 10 {
                    let stereo = self.dump.lock().unwrap().clone();
                    std::thread::spawn(move || {
                        let path = std::path::Path::new("/tmp/fdmix.raw");
                        let _ = std::fs::write(path, bytemuck::cast_slice(&stereo));
                        log::info!("mix capturado em {path:?} ({} amostras)", stereo.len());
                    });
                }
            }
            if let Some(ring) = self.shared.output_ring.lock().unwrap().as_ref() {
                let energia = (mix.iter().map(|s| s * s).sum::<f32>() / mix.len().max(1) as f32)
                    .sqrt();
                ring.push(&mix);
                let mut last = self.last_log.lock().unwrap();
                if last.elapsed() >= Duration::from_secs(1) {
                    log::info!(
                        "recebendo: {} usuários no tick, {} amostras, rms_mix={:.4}, ring_saída={}",
                        tick.speaking.len(),
                        mix.len(),
                        energia,
                        ring.len()
                    );
                    *last = Instant::now();
                }
            }
        }

        // Speaking indicators: the tick lists exactly who produced audio.
        let mut current = self.speaking.lock().unwrap();
        let now: HashSet<u32> = tick
            .speaking
            .keys()
            .filter(|ssrc| map.contains_key(*ssrc))
            .copied()
            .collect();
        // Out-of-sync signatures, either one sustained for a few seconds:
        // an SSRC speaking without a user mapping (fresh SSRC after a
        // far-side reconnect), or packets that arrive but fail to decode
        // (DAVE re-key — the mixer gets silence for a mapped user).
        let decode_failing = tick.speaking.values().any(|data| {
            data.packet.is_some() && data.decoded_voice.as_ref().is_none_or(Vec::is_empty)
        });
        let unmapped = tick
            .speaking
            .keys()
            .any(|ssrc| !map.contains_key(ssrc));
        if unmapped || decode_failing {
            let mut suspect = self.unmapped_since.lock().unwrap();
            let (since, reported) = suspect.get_or_insert((Instant::now(), false));
            if !*reported && since.elapsed() > Duration::from_secs(5) {
                log::warn!(
                    "voz fora de sincronia há 5s (não mapeado: {unmapped}, decode falhando: {decode_failing}); refazendo a sessão"
                );
                self.event_tx.send(UiEvent::VoiceSuspectDesync);
                *reported = true;
            }
        } else {
            *self.unmapped_since.lock().unwrap() = None;
        }
        for ssrc in now.difference(&current) {
            if let Some(user) = map.get(ssrc) {
                self.event_tx.send(UiEvent::VoiceSpeaking {
                    user_id: user.clone(),
                    speaking: true,
                });
            }
        }
        for ssrc in current.difference(&now) {
            if let Some(user) = map.get(ssrc) {
                self.event_tx.send(UiEvent::VoiceSpeaking {
                    user_id: user.clone(),
                    speaking: false,
                });
            }
        }
        *current = now;
        None
    }
}

/// Watches raw RTP arrivals: packets flowing from an SSRC with no user
/// mapping for a few seconds means the session lost sync (fresh SSRC after
/// a far-side reconnect, DAVE re-key) — the decode-failure state that never
/// shows up in VoiceTicks. Asks for a fresh handshake.
struct RtpWatch {
    shared: Arc<Shared>,
    event_tx: EventTx,
    first_seen: Mutex<HashMap<u32, Instant>>,
}

#[async_trait]
impl EventHandler for RtpWatch {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        let EventContext::RtpPacket(packet) = ctx else {
            return None;
        };
        let ssrc = packet.rtp().get_ssrc();
        if self.shared.ssrc_map.lock().unwrap().contains_key(&ssrc) {
            let mut first_seen = self.first_seen.lock().unwrap();
            first_seen.remove(&ssrc);
            if first_seen.is_empty() {
                self.shared.desync_reported.store(false, Ordering::Relaxed);
            }
            return None;
        }
        let mut first_seen = self.first_seen.lock().unwrap();
        let since = first_seen.entry(ssrc).or_insert_with(Instant::now);
        if since.elapsed() > Duration::from_secs(5)
            && !self
                .shared
                .desync_reported
                .swap(true, Ordering::Relaxed)
        {
            log::warn!("rtp do ssrc {ssrc} sem mapa há 5s; sessão de voz fora de sincronia");
            self.event_tx.send(UiEvent::VoiceSuspectDesync);
        }
        None
    }
}

/// Maps SSRC → user id from voice-gateway op 5, feeding the mixer and the
/// speaking indicators.
struct SpeakMap {
    ssrc_map: Arc<Mutex<HashMap<u32, String>>>,
}

#[async_trait]
impl EventHandler for SpeakMap {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        if let EventContext::SpeakingStateUpdate(speaking) = ctx
            && let Some(user_id) = speaking.user_id
        {
            self.ssrc_map
                .lock()
                .unwrap()
                .insert(speaking.ssrc, user_id.to_string());
        }
        None
    }
}

/// Clears a disconnected user from the SSRC map and the indicators.
struct DisconnectCleaner {
    shared: Arc<Shared>,
    event_tx: EventTx,
}

#[async_trait]
impl EventHandler for DisconnectCleaner {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        if let EventContext::ClientDisconnect(payload) = ctx {
            let user_id = payload.user_id.to_string();
            self.shared
                .ssrc_map
                .lock()
                .unwrap()
                .retain(|_, user| *user != user_id);
            self.event_tx.send(UiEvent::VoiceSpeaking {
                user_id,
                speaking: false,
            });
        }
        None
    }
}

pub async fn run(
    mut cmd_rx: UnboundedReceiver<VoiceCommand>,
    mut wire_rx: UnboundedReceiver<Wire>,
    event_tx: EventTx,
) {
    let shared = Arc::new(Shared::default());
    // Receive+decode other users; send a mono mix (voice norm, halves the
    // encode cost).
    let mut driver = Driver::new(
        Config::default()
            .decode_mode(DecodeMode::Decode(DecodeConfig::default()))
            .mix_mode(MixMode::Mono)
            // 8 packets ≈ 160 ms of receive-side de-jitter (Wi-Fi).
            .playout_buffer_length(std::num::NonZeroU8::new(8).unwrap()),
    );
    driver.add_global_event(
        Event::Core(CoreEvent::VoiceTick),
        TickMixer {
            shared: Arc::clone(&shared),
            event_tx: event_tx.clone(),
            speaking: Mutex::new(HashSet::new()),
            dump: Mutex::new(Vec::new()),
            dump_samples: std::sync::atomic::AtomicUsize::new(0),
            last_log: Mutex::new(Instant::now()),
            unmapped_since: Mutex::new(None),
        },
    );
    driver.add_global_event(
        Event::Core(CoreEvent::SpeakingStateUpdate),
        SpeakMap {
            ssrc_map: Arc::clone(&shared.ssrc_map),
        },
    );
    driver.add_global_event(
        Event::Core(CoreEvent::RtpPacket),
        RtpWatch {
            shared: Arc::clone(&shared),
            event_tx: event_tx.clone(),
            first_seen: Mutex::new(HashMap::new()),
        },
    );
    driver.add_global_event(
        Event::Core(CoreEvent::ClientDisconnect),
        DisconnectCleaner {
            shared: Arc::clone(&shared),
            event_tx: event_tx.clone(),
        },
    );

    let mut conn = Conn::Idle;
    let mut audio_links: Option<AudioLinks> = None;
    let mut audio_cfg = AudioConfig::default();

    loop {
        let deadline = match &conn {
            Conn::Pending(pending) => Some(pending.since + JOIN_TIMEOUT),
            Conn::Live {
                since: Some(since), ..
            } => Some(*since + JOIN_TIMEOUT),
            _ => None,
        };
        let timed_out = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(at.into()).await,
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            command = cmd_rx.recv() => match command {
                Some(command) => {
                    handle_command(&mut driver, &mut conn, &shared, command, &event_tx, &mut audio_links, &mut audio_cfg)
                        .await;
                }
                None => break,
            },
            wire = wire_rx.recv() => match wire {
                Some(wire) => {
                    handle_wire(&mut driver, &mut conn, &shared, wire, &event_tx, &mut audio_links, &audio_cfg)
                        .await;
                }
                None => break,
            },
            _ = timed_out => match &mut conn {
                Conn::Pending(pending) => {
                    log::warn!("join de voz expirou aguardando o Discord (guild {})", pending.guild_id);
                    event_tx.send(UiEvent::VoiceFailed {
                        error: "o Discord não respondeu ao entrar no canal de voz".into(),
                    });
                    conn = Conn::Idle;
                }
                // A channel move was never confirmed; reality is still the
                // old channel, so put the UI back there.
                Conn::Live { info, since } => {
                    event_tx.send(UiEvent::VoiceConnected {
                        guild_id: info.guild_id.to_string(),
                        channel_id: info.channel_id.to_string(),
                    });
                    *since = None;
                }
                Conn::Idle => {}
            },
        }
    }
}

/// Creates the audio streams on first use; after that, everything is
/// applied live (device retarget, capture params) — restarts were the
/// source of every "funciona e para" bug.
fn ensure_audio(
    driver: &mut Driver,
    shared: &Shared,
    links: &mut Option<AudioLinks>,
    cfg: &AudioConfig,
) {
    if links.is_none() {
        let new_links = audio::start(
            cfg.output_device.as_deref(),
            cfg.input_device.as_deref(),
            cfg.sensitivity,
            cfg.noise_suppression,
            Arc::clone(&shared.capture),
        );
        *shared.output_ring.lock().unwrap() = Some(Arc::clone(&new_links.output_ring));
        let mic = RawAdapter::new(
            MicSource::new(Arc::clone(&new_links.input_ring)),
            VOICE_RATE,
            1,
        );
        driver.play_only_input(mic.into());
        *links = Some(new_links);
        log::info!("streams de áudio criados");
    } else if let Some(links) = links {
        links.set_devices(cfg.output_device.clone(), cfg.input_device.clone());
    }
    shared.capture.lock().unwrap().set_sensitivity(cfg.sensitivity);
    shared
        .capture
        .lock()
        .unwrap()
        .set_noise_suppression(cfg.noise_suppression);
}

/// Between calls: cork both streams (mic off — privacy), stop the mixer
/// from feeding the ring and forget SSRC mappings.
fn pause_audio(shared: &Shared, links: &Option<AudioLinks>) {
    if let Some(links) = links {
        links.set_corked(true);
    }
    *shared.output_ring.lock().unwrap() = None;
    shared.ssrc_map.lock().unwrap().clear();
}

async fn handle_command(
    driver: &mut Driver,
    conn: &mut Conn,
    shared: &Arc<Shared>,
    command: VoiceCommand,
    event_tx: &EventTx,
    audio_links: &mut Option<AudioLinks>,
    audio_cfg: &mut AudioConfig,
) {
    match command {
        VoiceCommand::Join {
            guild_id,
            channel_id,
            user_id,
        } => match conn {
            Conn::Idle | Conn::Pending(_) => {
                *conn = Conn::Pending(Pending::new(guild_id, channel_id, user_id));
            }
            Conn::Live { info, since } => {
                if info.guild_id.to_string() != guild_id {
                    // Discord only allows one voice connection per session;
                    // switching guilds starts a fresh handshake.
                    driver.leave();
                    pause_audio(shared, audio_links);
                    *conn = Conn::Pending(Pending::new(guild_id, channel_id, user_id));
                } else if info.channel_id.to_string() == channel_id {
                    // Already there; nothing for the driver to do. The UI
                    // reconciles through the next voice state update.
                    *since = None;
                } else {
                    // Intra-guild moves keep the voice session: op 4 alone
                    // moves us, and Discord confirms with a state update.
                    *since = Some(Instant::now());
                }
            }
        },
        VoiceCommand::Leave => {
            if !matches!(conn, Conn::Idle) {
                driver.leave();
                pause_audio(shared, audio_links);
                event_tx.send(UiEvent::VoiceLeft);
            }
            *conn = Conn::Idle;
        }
        VoiceCommand::SetMute { muted } => {
            shared.self_muted.store(muted, Ordering::Relaxed);
            let deafened = shared.deafened.load(Ordering::Relaxed);
            driver.mute(muted || deafened);
        }
        VoiceCommand::SetDeaf { deafened } => {
            shared.deafened.store(deafened, Ordering::Relaxed);
            driver.mute(deafened || shared.self_muted.load(Ordering::Relaxed));
        }
        VoiceCommand::SetRoster(users) => {
            let mut roster = shared.roster.lock().unwrap();
            if *roster != users {
                roster.clone_from(&users);
                drop(roster);
                driver.set_recognized_users(users);
            }
        }
        VoiceCommand::SetUserVolume { user_id, volume } => {
            shared
                .volumes
                .lock()
                .unwrap()
                .insert(user_id, volume.clamp(0.0, 2.0));
        }
        VoiceCommand::ApplyConfig {
            input_device,
            output_device,
            sensitivity,
            noise_suppression,
        } => {
            let new = AudioConfig {
                input_device,
                output_device,
                sensitivity,
                noise_suppression,
            };
            let live = audio_links.is_some();
            log::info!(
                "applyconfig: novo={new:?} guardado={:?} live={live}",
                audio_cfg
            );
            if new != *audio_cfg || !live {
                *audio_cfg = new;
                if live {
                    ensure_audio(driver, shared, audio_links, audio_cfg);
                }
            }
        }
    }
}

async fn handle_wire(
    driver: &mut Driver,
    conn: &mut Conn,
    shared: &Arc<Shared>,
    wire: Wire,
    event_tx: &EventTx,
    audio_links: &mut Option<AudioLinks>,
    audio_cfg: &AudioConfig,
) {
    match &wire {
        Wire::State(state) => {
            log::info!("voz recebeu State: user={} canal={:?} guild={:?} (conn: {})",
                state.user_id, state.channel_id, state.guild_id,
                match conn { Conn::Idle => "idle", Conn::Pending(_) => "pending", Conn::Live { .. } => "live" });
        }
        Wire::Server { guild_id, endpoint, .. } => {
            log::info!("voz recebeu Server: guild={guild_id} endpoint={endpoint} (conn: {})",
                match conn { Conn::Idle => "idle", Conn::Pending(_) => "pending", Conn::Live { .. } => "live" });
        }
    }
    match wire {
        Wire::State(state) => match conn {
            Conn::Live { info, since } if info.user_id.to_string() == state.user_id => {
                match &state.channel_id {
                    // Kicked or disconnected from elsewhere.
                    None => {
                        driver.leave();
                        pause_audio(shared, audio_links);
                        event_tx.send(UiEvent::VoiceLeft);
                        *conn = Conn::Idle;
                    }
                    Some(channel_id) => {
                        // A new session id means the server recreated our
                        // voice session: reconnect with the current server.
                        if info.session_id != state.session_id {
                            let pending = Pending {
                                guild_id: info.guild_id.to_string(),
                                channel_id: channel_id.clone(),
                                user_id: state.user_id.clone(),
                                session_id: Some(state.session_id.clone()),
                                endpoint: Some(info.endpoint.clone()),
                                token: Some(info.token.clone()),
                                since: Instant::now(),
                            };
                            driver.leave();
                            pause_audio(shared, audio_links);
                            *conn = Conn::Pending(pending);
                            return;
                        }
                        if info.channel_id.to_string() != *channel_id {
                            info.channel_id = channel_id
                                .parse::<NonZeroU64>()
                                .map(ChannelId)
                                .unwrap_or(info.channel_id);
                            event_tx.send(UiEvent::VoiceConnected {
                                guild_id: info.guild_id.to_string(),
                                channel_id: info.channel_id.to_string(),
                            });
                        }
                        *since = None;
                    }
                }
            }
            Conn::Pending(pending) if pending.user_id == state.user_id => match &state.channel_id {
                None => {
                    event_tx.send(UiEvent::VoiceLeft);
                    *conn = Conn::Idle;
                }
                Some(_) => {
                    pending.apply_state(&state);
                    try_connect(driver, conn, shared, event_tx, audio_links, audio_cfg).await;
                }
            },
            _ => {}
        },
        Wire::Server {
            guild_id,
            endpoint,
            token,
            session_id,
        } => match conn {
            Conn::Pending(pending) if pending.guild_id == guild_id => {
                if pending.session_id.is_none() && !session_id.is_empty() {
                    pending.session_id = Some(session_id);
                }
                pending.endpoint = Some(endpoint);
                pending.token = Some(token);
                try_connect(driver, conn, shared, event_tx, audio_links, audio_cfg).await;
            }
            // Discord re-homed the voice server mid-call: reconnect in place.
            Conn::Live { info, .. } if info.guild_id.to_string() == guild_id => {
                let pending = Pending {
                    guild_id,
                    channel_id: info.channel_id.to_string(),
                    user_id: info.user_id.to_string(),
                    session_id: Some(info.session_id.clone()),
                    endpoint: Some(endpoint),
                    token: Some(token),
                    since: Instant::now(),
                };
                driver.leave();
                pause_audio(shared, audio_links);
                *conn = Conn::Pending(pending);
            }
            _ => {}
        },
    }
}

/// Completes a pending join once session id, endpoint and token are known.
async fn try_connect(
    driver: &mut Driver,
    conn: &mut Conn,
    shared: &Arc<Shared>,
    event_tx: &EventTx,
    audio_links: &mut Option<AudioLinks>,
    audio_cfg: &AudioConfig,
) {
    let Conn::Pending(pending) = conn else {
        return;
    };
    let Some(info) = pending.info() else {
        return;
    };
    match driver.connect(info.clone()).await {
        Ok(()) => {
            log::info!("voz conectada ao canal {}", info.channel_id);
            ensure_audio(driver, shared, audio_links, audio_cfg);
            // Our own green indicator comes from the mic's voice-activity
            // gate; VoiceTicks only carry other users.
            let (tx, me, flags) = (event_tx.clone(), info.user_id.to_string(), Arc::clone(shared));
            let mut lit = false;
            shared.capture.lock().unwrap().on_speaking = Some(Box::new(move |speaking| {
                let now = speaking
                    && !flags.self_muted.load(Ordering::Relaxed)
                    && !flags.deafened.load(Ordering::Relaxed);
                if now != lit {
                    lit = now;
                    tx.send(UiEvent::VoiceSpeaking {
                        user_id: me.clone(),
                        speaking: now,
                    });
                }
            }));
            // The MLS group must recognize every member or their media
            // stays encrypted (vendored songbird patch, upstream #310).
            driver.set_recognized_users(shared.roster.lock().unwrap().clone());
            if let Some(links) = audio_links {
                links.output_ring.clear();
                links.input_ring.clear();
                links.set_corked(false);
            }
            *shared.output_ring.lock().unwrap() =
                audio_links.as_ref().map(|l| Arc::clone(&l.output_ring));
            *conn = Conn::Live {
                info: Box::new(info),
                since: None,
            };
            event_tx.send(UiEvent::VoiceConnected {
                guild_id: conn_guild(conn),
                channel_id: conn_channel(conn),
            });
        }
        Err(err) => {
            log::warn!("falha ao conectar à voz: {err}");
            event_tx.send(UiEvent::VoiceFailed {
                error: err.to_string(),
            });
            *conn = Conn::Idle;
        }
    }
}

fn conn_guild(conn: &Conn) -> String {
    match conn {
        Conn::Live { info, .. } => info.guild_id.to_string(),
        _ => String::new(),
    }
}

fn conn_channel(conn: &Conn) -> String {
    match conn {
        Conn::Live { info, .. } => info.channel_id.to_string(),
        _ => String::new(),
    }
}
