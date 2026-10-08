//! Go Live stream connection (docs/SCREENSHARE.md, phase 3): a second
//! voice-gateway session next to the call's, on the stream server Discord
//! allocated. Songbird can't carry video (fixed Identify, no `codecs`), so
//! the handshake is spelled out here; the DAVE messages reuse songbird's
//! model and follow its state machine (third_party/songbird
//! `driver/tasks/ws.rs`), in the stream's own MLS group.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::num::NonZeroU16;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use songbird::model::payload::{
    DaveMlsCommitWelcome, DaveMlsInvalidCommitWelcome, DaveMlsKeyPackage,
    DaveMlsProposalsOperationType, DaveTransitionReady,
};
use songbird::model::{Event, deserialize_binary_event, serialize_binary_event};
use tokio::net::UdpSocket;
use tokio_tungstenite::tungstenite::Message;

use crate::backend::EventTx;
use crate::backend::capture::Frame;
use crate::backend::rtp::{self, Cipher, H264Depacketizer};

/// Payload types we offer; Discord echoes the chosen video codec back.
const H264_PT: u8 = 105;
const H264_RTX_PT: u8 = 106;
/// The only transport mode we implement (see rtp.rs).
const MODE: &str = "aead_aes256_gcm_rtpsize";

/// Which side of the stream we are.
pub enum Role {
    /// Our own Go Live: we send video.
    Stream,
    /// Watching `streamer`'s stream: decoded frames land in `frames`.
    Watch {
        streamer: u64,
        frames: Arc<Mutex<Option<Frame>>>,
        events: EventTx,
    },
}

/// What STREAM_CREATE + STREAM_SERVER_UPDATE hand us for our stream.
#[derive(Clone, Debug)]
pub struct StreamInfo {
    pub endpoint: String,
    pub token: String,
    pub rtc_server_id: String,
    /// The stream's DAVE group id (`rtc_server_id - 1`, sent by Discord).
    pub rtc_channel_id: u64,
    /// The call's session id: the stream rides on the same voice session.
    pub session_id: String,
    pub user_id: u64,
}

/// Runs until the stream server drops us or the task is aborted.
pub async fn run(info: StreamInfo, role: Role) {
    match connect(&info, &role).await {
        Ok(()) => log::info!("transmissão: conexão encerrada"),
        Err(err) => log::warn!("transmissão: {err}"),
    }
}

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

async fn send_json(ws: &mut Ws, value: Value) -> Result<(), String> {
    ws.send(Message::text(value.to_string()))
        .await
        .map_err(|err| format!("ws: {err}"))
}

async fn send_event(ws: &mut Ws, event: Event) -> Result<(), String> {
    let text = serde_json::to_string(&event).map_err(|err| err.to_string())?;
    ws.send(Message::text(text)).await.map_err(|err| format!("ws: {err}"))
}

async fn send_binary(ws: &mut Ws, event: Event) -> Result<(), String> {
    let bytes = serialize_binary_event(&event).map_err(|err| format!("{err:?}"))?;
    ws.send(Message::binary(bytes)).await.map_err(|err| format!("ws: {err}"))
}

/// Next JSON payload (`op`, `d`), skipping pings and stray binary frames.
async fn next_json(ws: &mut Ws) -> Result<(u64, Value), String> {
    loop {
        let message = ws
            .next()
            .await
            .ok_or("o servidor fechou a conexão")?
            .map_err(|err| format!("ws: {err}"))?;
        match message {
            Message::Text(text) => {
                let value: Value = serde_json::from_str(&text).map_err(|err| err.to_string())?;
                let op = value.get("op").and_then(Value::as_u64).unwrap_or(u64::MAX);
                return Ok((op, value.get("d").cloned().unwrap_or(Value::Null)));
            }
            Message::Close(frame) => return Err(format!("servidor fechou: {frame:?}")),
            _ => {}
        }
    }
}

async fn connect(info: &StreamInfo, role: &Role) -> Result<(), String> {
    let host = info.endpoint.trim_start_matches("wss://").trim_end_matches('/');
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("wss://{host}/?v=4"))
        .await
        .map_err(|err| format!("falha ao conectar em {host}: {err}"))?;
    log::info!("transmissão: conectado a {host}");

    send_json(
        &mut ws,
        json!({
            "op": 0,
            "d": {
                "server_id": info.rtc_server_id,
                "user_id": info.user_id.to_string(),
                "session_id": info.session_id,
                "token": info.token,
                "video": true,
                "streams": [{ "type": "screen", "rid": "100", "quality": 100 }],
                "max_dave_protocol_version": davey::DAVE_PROTOCOL_VERSION,
            }
        }),
    )
    .await?;

    // Hello (8) and Ready (2) arrive in either order.
    let (mut heartbeat_ms, mut ready) = (None, None);
    while heartbeat_ms.is_none() || ready.is_none() {
        match next_json(&mut ws).await? {
            (8, d) => heartbeat_ms = d.get("heartbeat_interval").and_then(Value::as_f64),
            (2, d) => ready = Some(d),
            (op, d) => log::debug!("transmissão: antes do ready, op {op}: {d}"),
        }
    }
    let ready = ready.unwrap_or_default();
    let field = |value: &Value, name: &str| value.get(name).and_then(Value::as_u64);
    let audio_ssrc = field(&ready, "ssrc").ok_or("ready sem ssrc")? as u32;
    let video = ready
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| streams.first())
        .cloned()
        .unwrap_or_default();
    let video_ssrc = field(&video, "ssrc").ok_or("ready sem stream de vídeo")? as u32;
    let rtx_ssrc = field(&video, "rtx_ssrc").unwrap_or(0) as u32;
    let modes: Vec<&str> = ready
        .get("modes")
        .and_then(Value::as_array)
        .map(|modes| modes.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !modes.contains(&MODE) {
        return Err(format!("servidor não oferece {MODE}: {modes:?}"));
    }
    let ip = ready.get("ip").and_then(Value::as_str).ok_or("ready sem ip")?;
    let port = field(&ready, "port").ok_or("ready sem porta")? as u16;
    log::info!(
        "transmissão: ready ssrc áudio={audio_ssrc} vídeo={video_ssrc} rtx={rtx_ssrc} udp={ip}:{port}"
    );

    let udp = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|err| format!("udp: {err}"))?;
    udp.connect((ip, port))
        .await
        .map_err(|err| format!("udp: {err}"))?;
    let (address, external_port) = discover_ip(&udp, audio_ssrc).await?;

    send_json(
        &mut ws,
        json!({
            "op": 1,
            "d": {
                "protocol": "udp",
                "data": { "address": address.to_string(), "port": external_port, "mode": MODE },
                "codecs": [
                    { "name": "opus", "type": "audio", "priority": 1000, "payload_type": 120 },
                    {
                        "name": "H264", "type": "video", "priority": 1000,
                        "payload_type": H264_PT, "rtx_payload_type": H264_RTX_PT,
                        "encode": true, "decode": true,
                    },
                ],
            }
        }),
    )
    .await?;

    // Session Description (4): transport key, codec and DAVE version.
    let description = loop {
        match next_json(&mut ws).await? {
            (4, d) => break d,
            (op, d) => log::debug!("transmissão: antes da descrição, op {op}: {d}"),
        }
    };
    let dave_version = field(&description, "dave_protocol_version").unwrap_or(0) as u16;
    log::info!(
        "transmissão: sessão modo={:?} vídeo={:?} dave={dave_version}",
        description.get("mode"),
        description.get("video_codec"),
    );
    let mut dave = Dave::new(info.user_id, info.rtc_channel_id, dave_version);
    if let Some(key_package) = dave.key_package()? {
        send_binary(&mut ws, Event::DaveMlsKeyPackage(DaveMlsKeyPackage { key_package })).await?;
    }

    let key: Vec<u8> = description
        .get("secret_key")
        .and_then(Value::as_array)
        .map(|bytes| bytes.iter().filter_map(Value::as_u64).map(|b| b as u8).collect())
        .unwrap_or_default();
    let cipher = Cipher::new(&key).ok_or("chave de transporte inválida")?;
    // ponytail: one counter for RTP and RTCP, as discord-native-voice does.
    let mut counter = 0u32;

    // Video (12) must precede any media, sent or received.
    match role {
        Role::Stream => {
            send_json(
                &mut ws,
                json!({
                    "op": 12,
                    "d": {
                        "audio_ssrc": audio_ssrc,
                        "video_ssrc": video_ssrc,
                        "rtx_ssrc": rtx_ssrc,
                        "streams": [{
                            "type": "video", "rid": "100", "ssrc": video_ssrc, "rtx_ssrc": rtx_ssrc,
                            "active": true, "quality": 100,
                            "max_bitrate": 2_500_000, "max_framerate": 30,
                            "max_resolution": { "type": "fixed", "width": 1280, "height": 720 },
                        }],
                    }
                }),
            )
            .await?;
            send_json(&mut ws, json!({ "op": 5, "d": { "speaking": 2, "delay": 0, "ssrc": audio_ssrc } }))
                .await?;
        }
        Role::Watch { .. } => {
            send_json(
                &mut ws,
                json!({ "op": 12, "d": { "audio_ssrc": audio_ssrc, "video_ssrc": 0, "rtx_ssrc": 0, "streams": [] } }),
            )
            .await?;
            send_json(&mut ws, json!({ "op": 15, "d": { "any": 100 } })).await?;
        }
    }

    // The viewer's video path: depacketize → DAVE → decode thread.
    let mut depacketizer = H264Depacketizer::default();
    let decoder = match role {
        Role::Watch { frames, events, .. } => Some(spawn_decoder(frames.clone(), events.clone())?),
        Role::Stream => None,
    };
    let mut keyframe_asked: Option<std::time::Instant> = None;
    let mut buf = vec![0u8; 2048];

    let mut heartbeat =
        tokio::time::interval(Duration::from_millis(heartbeat_ms.unwrap_or(13_750.0) as u64));
    let mut report = tokio::time::interval(Duration::from_secs(5));
    let mut was_ready = false;
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                let nonce = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |elapsed| elapsed.as_millis() as u64);
                send_json(&mut ws, json!({ "op": 3, "d": nonce })).await?;
            }
            _ = report.tick() => {
                counter = counter.wrapping_add(1);
                if let Some(packet) = rtp::receiver_report(&cipher, audio_ssrc, counter) {
                    let _ = udp.send(&packet).await;
                }
            }
            received = udp.recv(&mut buf) => {
                let Ok(len) = received else { continue };
                let (Some(rtp), Role::Watch { streamer, .. }) = (cipher.open_rtp(&buf[..len]), role) else {
                    continue;
                };
                // ponytail: any H264 packet is the streamer's (one sender per
                // stream); op 12's ssrc map would matter with simulcast.
                if rtp.payload_type != H264_PT {
                    continue;
                }
                let frame = depacketizer.push(&rtp);
                let want_keyframe = match &frame {
                    Ok(Some(frame)) => {
                        let plain = match dave.session.as_mut() {
                            Some(session) if dave.version != 0 => {
                                session.decrypt(*streamer, davey::MediaType::VIDEO, frame)
                            }
                            _ => Ok(frame.clone()),
                        };
                        match plain {
                            Ok(plain) => {
                                let _ = decoder.as_ref().map(|tx| tx.send(plain));
                                false
                            }
                            Err(err) => {
                                log::debug!("transmissão: DAVE não decifrou: {err:?}");
                                true
                            }
                        }
                    }
                    Ok(None) => keyframe_asked.is_none(),
                    Err(()) => true,
                };
                // At most one PLI a second (startup, losses, undecryptable).
                if want_keyframe && keyframe_asked.is_none_or(|at| at.elapsed() > Duration::from_secs(1)) {
                    keyframe_asked = Some(std::time::Instant::now());
                    counter = counter.wrapping_add(1);
                    if let Some(packet) = rtp::pli(&cipher, audio_ssrc, rtp.ssrc, counter) {
                        let _ = udp.send(&packet).await;
                    }
                }
            }
            message = ws.next() => {
                let message = message
                    .ok_or("o servidor fechou a conexão")?
                    .map_err(|err| format!("ws: {err}"))?;
                let event = match message {
                    Message::Binary(bytes) => match deserialize_binary_event(&bytes) {
                        Ok(event) => Some(event),
                        Err(err) => {
                            log::debug!("transmissão: binário desconhecido: {err:?}");
                            None
                        }
                    },
                    // DAVE's JSON ops (21, 22, 24) parse as model events;
                    // everything else (acks, op 12/15 from the server…) is
                    // only logged.
                    Message::Text(text) => {
                        let event = serde_json::from_str::<Event>(&text).ok();
                        if event.is_none() {
                            log::debug!("transmissão: recebido {}", &text[..text.len().min(300)]);
                        }
                        event
                    }
                    Message::Close(frame) => return Err(format!("servidor fechou: {frame:?}")),
                    _ => None,
                };
                if let Some(event) = event {
                    log::debug!("transmissão: evento {event:?}");
                    for reply in dave.handle(event)? {
                        match reply {
                            Reply::Json(event) => send_event(&mut ws, event).await?,
                            Reply::Binary(event) => send_binary(&mut ws, event).await?,
                        }
                    }
                }
                if !was_ready && dave.is_ready() {
                    was_ready = true;
                    log::info!("transmissão: DAVE pronto (grupo {})", info.rtc_channel_id);
                }
            }
        }
    }
}

/// openh264's decoder isn't `Send`, so it lives on its own thread: Annex-B
/// frames in, RGBA frames into the shared slot. Ends when the sender drops.
fn spawn_decoder(
    frames: Arc<Mutex<Option<Frame>>>,
    events: EventTx,
) -> Result<std::sync::mpsc::Sender<Vec<u8>>, String> {
    use openh264::formats::YUVSource;
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::Builder::new()
        .name("fastdiscord-h264".into())
        .spawn(move || {
            let mut decoder = match openh264::decoder::Decoder::new() {
                Ok(decoder) => decoder,
                Err(err) => return log::warn!("transmissão: decoder H264: {err}"),
            };
            let mut seq = 0;
            for frame in rx {
                let yuv = match decoder.decode(&frame) {
                    Ok(Some(yuv)) => yuv,
                    Ok(None) => continue,
                    Err(err) => {
                        log::debug!("transmissão: decode falhou: {err}");
                        continue;
                    }
                };
                let (width, height) = yuv.dimensions();
                let mut pixels = vec![0; width * height * 4];
                yuv.write_rgba8(&mut pixels);
                seq += 1;
                *frames.lock().unwrap() = Some(Frame {
                    width: width as u32,
                    height: height as u32,
                    pixels,
                    bgr: false,
                    seq,
                });
                events.repaint();
            }
        })
        .map_err(|err| format!("thread do decoder: {err}"))?;
    Ok(tx)
}

/// Discord's IP discovery: 74-byte request (type 1, length 70, ssrc),
/// answered with our external address and port.
async fn discover_ip(udp: &UdpSocket, ssrc: u32) -> Result<(IpAddr, u16), String> {
    let mut packet = [0u8; 74];
    packet[..2].copy_from_slice(&1u16.to_be_bytes());
    packet[2..4].copy_from_slice(&70u16.to_be_bytes());
    packet[4..8].copy_from_slice(&ssrc.to_be_bytes());
    udp.send(&packet).await.map_err(|err| format!("udp: {err}"))?;
    let len = tokio::time::timeout(Duration::from_secs(5), udp.recv(&mut packet))
        .await
        .map_err(|_| "descoberta de IP sem resposta")?
        .map_err(|err| format!("udp: {err}"))?;
    parse_discovery(&packet[..len]).ok_or_else(|| "resposta de descoberta inválida".into())
}

fn parse_discovery(packet: &[u8]) -> Option<(IpAddr, u16)> {
    if packet.len() < 74 || packet[..2] != 2u16.to_be_bytes() {
        return None;
    }
    let address = &packet[8..72];
    let end = address.iter().position(|&b| b == 0)?;
    let ip = std::str::from_utf8(&address[..end]).ok()?.parse().ok()?;
    Some((ip, u16::from_be_bytes([packet[72], packet[73]])))
}

enum Reply {
    Json(Event),
    Binary(Event),
}

/// The stream's DAVE session; mirrors songbird's ws task, minus the
/// recognized-users check (viewers come and go; the server vets them).
struct Dave {
    session: Option<davey::DaveSession>,
    version: u16,
    pending: HashMap<u16, u16>,
    user_id: u64,
    group: u64,
}

impl Dave {
    fn new(user_id: u64, group: u64, version: u16) -> Self {
        Self {
            session: None,
            version,
            pending: HashMap::new(),
            user_id,
            group,
        }
    }

    fn is_ready(&self) -> bool {
        self.session.as_ref().is_some_and(davey::DaveSession::is_ready)
    }

    /// (Re)initializes the session for the current version and returns the
    /// key package to announce; a version of 0 means transport-only.
    // ponytail: fresh identity key per stream; share the voice one (needs
    // a songbird patch) once clients flag the stream as unverified.
    fn key_package(&mut self) -> Result<Option<Vec<u8>>, String> {
        let Some(version) = NonZeroU16::new(self.version) else {
            if let Some(session) = self.session.as_mut() {
                let _ = session.reset();
                session.set_passthrough_mode(true, Some(10));
            }
            return Ok(None);
        };
        let session = match self.session.as_mut() {
            Some(session) => {
                session
                    .reinit(version, self.user_id, self.group, None)
                    .map_err(|err| format!("dave reinit: {err:?}"))?;
                session
            }
            None => self.session.insert(
                davey::DaveSession::new(version, self.user_id, self.group, None)
                    .map_err(|err| format!("dave: {err:?}"))?,
            ),
        };
        session
            .create_key_package()
            .map(Some)
            .map_err(|err| format!("dave key package: {err:?}"))
    }

    fn reinit(&mut self, replies: &mut Vec<Reply>) -> Result<(), String> {
        if let Some(key_package) = self.key_package()? {
            replies.push(Reply::Binary(Event::DaveMlsKeyPackage(DaveMlsKeyPackage {
                key_package,
            })));
        }
        Ok(())
    }

    fn ready_for(&mut self, transition_id: u16, replies: &mut Vec<Reply>) {
        self.pending.insert(transition_id, self.version);
        replies.push(Reply::Json(Event::from(DaveTransitionReady {
            transition_id,
            protocol_version: self.version,
        })));
    }

    fn execute(&mut self, transition_id: u16) {
        let Some(version) = self.pending.remove(&transition_id) else {
            return;
        };
        let old = std::mem::replace(&mut self.version, version);
        if transition_id > 0 && old == 0 && version != 0 {
            if let Some(session) = self.session.as_mut() {
                session.set_passthrough_mode(true, Some(10));
            }
        }
    }

    fn handle(&mut self, event: Event) -> Result<Vec<Reply>, String> {
        let mut replies = Vec::new();
        match event {
            Event::DavePrepareTransition(ev) => {
                self.pending.insert(ev.transition_id, ev.protocol_version);
                if ev.transition_id == 0 {
                    self.execute(0);
                } else if ev.protocol_version == 0 {
                    if let Some(session) = self.session.as_mut() {
                        session.set_passthrough_mode(true, Some(120));
                    }
                    replies.push(Reply::Json(Event::from(DaveTransitionReady {
                        transition_id: ev.transition_id,
                        protocol_version: 0,
                    })));
                }
            }
            Event::DaveExecuteTransition(ev) => self.execute(ev.transition_id),
            Event::DavePrepareEpoch(ev) if ev.epoch == 1 => {
                self.version = ev.protocol_version;
                self.reinit(&mut replies)?;
            }
            Event::DaveMlsExternalSender(ev) => {
                if let Some(session) = self.session.as_mut()
                    && let Err(err) = session.set_external_sender(&ev.external_sender)
                {
                    log::warn!("transmissão: external sender: {err:?}");
                }
            }
            Event::DaveMlsProposals(ev) => {
                let operation = match ev.operation_type {
                    DaveMlsProposalsOperationType::Append => davey::ProposalsOperationType::APPEND,
                    DaveMlsProposalsOperationType::Revoke => davey::ProposalsOperationType::REVOKE,
                };
                let commit = self.session.as_mut().and_then(|session| {
                    session
                        .process_proposals(operation, &ev.proposals, None)
                        .inspect_err(|err| log::warn!("transmissão: proposals: {err:?}"))
                        .ok()
                        .flatten()
                });
                if let Some(commit) = commit {
                    replies.push(Reply::Binary(Event::from(DaveMlsCommitWelcome {
                        commit: commit.commit,
                        welcome: commit.welcome,
                    })));
                }
            }
            Event::DaveMlsAnnounceCommitTransition(ev) => {
                let outcome = self
                    .session
                    .as_mut()
                    .map(|session| session.process_commit(&ev.commit_message));
                match outcome {
                    Some(Ok(())) if ev.transition_id != 0 => {
                        self.ready_for(ev.transition_id, &mut replies);
                    }
                    Some(Err(err)) => {
                        log::warn!("transmissão: commit inválido: {err:?}");
                        replies.push(Reply::Json(Event::from(DaveMlsInvalidCommitWelcome {
                            transition_id: ev.transition_id,
                        })));
                        self.reinit(&mut replies)?;
                    }
                    _ => {}
                }
            }
            Event::DaveMlsWelcome(ev) => {
                let outcome = self
                    .session
                    .as_mut()
                    .map(|session| session.process_welcome(&ev.welcome));
                match outcome {
                    Some(Ok(())) if ev.transition_id != 0 => {
                        self.ready_for(ev.transition_id, &mut replies);
                    }
                    Some(Err(err)) => {
                        log::warn!("transmissão: welcome inválido: {err:?}");
                        replies.push(Reply::Json(Event::from(DaveMlsInvalidCommitWelcome {
                            transition_id: ev.transition_id,
                        })));
                        self.reinit(&mut replies)?;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        Ok(replies)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_discovery;

    #[test]
    fn discovery_response_yields_address_and_port() {
        let mut packet = [0u8; 74];
        packet[..2].copy_from_slice(&2u16.to_be_bytes());
        packet[8..8 + 11].copy_from_slice(b"203.0.113.7");
        packet[72..].copy_from_slice(&50_000u16.to_be_bytes());
        let (ip, port) = parse_discovery(&packet).unwrap();
        assert_eq!((ip.to_string().as_str(), port), ("203.0.113.7", 50_000));
        // A request echoed back is not a response.
        packet[..2].copy_from_slice(&1u16.to_be_bytes());
        assert!(parse_discovery(&packet).is_none());
    }
}
