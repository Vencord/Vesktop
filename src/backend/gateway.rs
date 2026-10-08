//! Discord Gateway: a persistent WebSocket session with heartbeats,
//! dispatch handling and reconnect-with-backoff. Sessions always re-IDENTIFY
//! after a drop — RESUME is tracked in docs/PORT.md.

use std::time::Duration;

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message as WsMessage,
};

use crate::model::{Message, User, VoiceState};

use super::api::{Api, ApiError};
use super::events::{Command, EventTx, UiEvent};
use super::voice::Wire;

const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// The write half of the live gateway socket, for protocol-level sends
/// like op 4.
type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, WsMessage>;

pub enum SessionEnd {
    /// The UI is gone; stop the whole task.
    Shutdown,
    /// Token rejected; stop and return to the login screen.
    Fatal(String),
    /// Retry with backoff.
    Reconnect(String),
}

/// Keeps gateway sessions alive until the process or UI goes away.
pub async fn run(
    token: String,
    mut cmd_rx: UnboundedReceiver<Command>,
    event_tx: EventTx,
    voice_tx: UnboundedSender<Wire>,
) {
    let api = Api::new(token);
    let mut backoff = Duration::from_secs(3);

    loop {
        // A session that died before READY usually means a rejected token;
        // confirm against the REST API before scheduling another retry.
        let mut ready_seen = false;
        let end = session(&api, &mut cmd_rx, &event_tx, &voice_tx, &mut ready_seen).await;
        match end {
            SessionEnd::Shutdown => break,
            SessionEnd::Fatal(why) => {
                log::error!("gateway session ended fatally: {why}");
                let _ = event_tx.send(UiEvent::Disconnected {
                    reason: why,
                    retry_in: None,
                });
                break;
            }
            SessionEnd::Reconnect(why) => {
                if !ready_seen && matches!(api.me().await, Err(ApiError::Unauthorized)) {
                    log::error!("token rejeitado, voltando ao login");
                    let _ = event_tx.send(UiEvent::TokenInvalid);
                    break;
                }
                log::warn!("gateway session ended: {why}");
                let _ = event_tx.send(UiEvent::Disconnected {
                    reason: why,
                    retry_in: Some(backoff.as_secs()),
                });
            }
        }

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

async fn session(
    api: &Api,
    cmd_rx: &mut UnboundedReceiver<Command>,
    event_tx: &EventTx,
    voice_tx: &UnboundedSender<Wire>,
    ready: &mut bool,
) -> SessionEnd {
    // The gateway session id, from READY — user accounts get no
    // VOICE_STATE_UPDATE for their own op 4, so this is where the voice
    // handshake's session id comes from (docs/VOICE.md).
    let mut session_id = String::new();
    let gateway = match api.gateway_url().await {
        Ok(url) => format!("{}/?v=10&encoding=json", url.trim_end_matches('/')),
        Err(ApiError::Unauthorized) => {
            let _ = event_tx.send(UiEvent::TokenInvalid);
            return SessionEnd::Fatal("token rejeitado pela API".into());
        }
        Err(err) => return SessionEnd::Reconnect(format!("falha ao obter o gateway: {err}")),
    };

    let (ws, _) = match connect_async(gateway.as_str()).await {
        Ok(pair) => pair,
        Err(err) => return SessionEnd::Reconnect(format!("falha ao conectar: {err}")),
    };
    let (mut write, mut read) = ws.split();
    log::info!("gateway connected");
    let _ = event_tx.send(UiEvent::Connected);

    // Discord opens with HELLO (op 10), which carries the heartbeat interval.
    let hello = match read.next().await {
        Some(Ok(msg)) => msg,
        Some(Err(err)) => return SessionEnd::Reconnect(format!("erro no handshake: {err}")),
        None => return SessionEnd::Reconnect("gateway fechou durante o handshake".into()),
    };
    let hello: Value = match hello
        .to_text()
        .map_err(|err| err.to_string())
        .and_then(|text| serde_json::from_str(text).map_err(|err| err.to_string()))
    {
        Ok(value) => value,
        Err(err) => return SessionEnd::Reconnect(format!("HELLO inválido: {err}")),
    };
    let heartbeat_ms = hello
        .pointer("/d/heartbeat_interval")
        .and_then(Value::as_u64)
        .unwrap_or(41_250);

    let mut heartbeat = tokio::time::interval(Duration::from_millis(heartbeat_ms));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut seq: Option<u64> = None;
    let mut acked = true;

    let token = api.token();
    if let Err(err) = write.send(WsMessage::text(identify_payload(&token))).await {
        return SessionEnd::Reconnect(format!("falha ao identificar: {err}"));
    }

    loop {
        tokio::select! {
            command = cmd_rx.recv() => match command {
                Some(command) => handle_command(api, command, event_tx, &mut write).await,
                None => {
                    let _ = write.send(WsMessage::Close(None)).await;
                    return SessionEnd::Shutdown;
                }
            },
            _ = heartbeat.tick() => {
                if !acked {
                    return SessionEnd::Reconnect("heartbeat sem ACK".into());
                }
                acked = false;
                if let Err(err) = write.send(WsMessage::text(json!({ "op": 1, "d": seq }).to_string())).await {
                    return SessionEnd::Reconnect(format!("falha ao enviar heartbeat: {err}"));
                }
            }
            frame = read.next() => match frame {
                Some(Ok(msg)) => {
                    let text = match msg.to_text() {
                        Ok(text) => text,
                        Err(_) => continue,
                    };
                    let value: Value = match serde_json::from_str(text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let op = value.get("op").and_then(Value::as_u64).unwrap_or(0);
                    match op {
                        1 => {
                            // Server-requested heartbeat; answer right away.
                            if let Err(err) = write.send(WsMessage::text(json!({ "op": 1, "d": seq }).to_string())).await {
                                return SessionEnd::Reconnect(format!("falha ao responder heartbeat: {err}"));
                            }
                        }
                        11 => acked = true,
                        7 => return SessionEnd::Reconnect("gateway pediu reconexão".into()),
                        9 => return SessionEnd::Reconnect("sessão inválida, reconectando".into()),
                        0 => {
                            if let Some(s) = value.get("s").and_then(Value::as_u64) {
                                seq = Some(s);
                            }
                            if value.get("t").and_then(Value::as_str) == Some("READY") {
                                *ready = true;
                            }
                            if value.get("t").and_then(Value::as_str) == Some("READY") {
                                if let Some(id) = value.pointer("/d/session_id").and_then(Value::as_str) {
                                    session_id = id.to_string();
                                }
                            }
                            dispatch(value, event_tx, voice_tx, &session_id);
                        }
                        _ => {
                            log::debug!(
                                "gateway op inesperado {op}: {:?}",
                                value.get("t").or_else(|| value.get("d")).map(|v| v.to_string()).unwrap_or_default().chars().take(200).collect::<String>()
                            );
                        }
                    }
                }
                Some(Err(err)) => return SessionEnd::Reconnect(format!("erro no gateway: {err}")),
                None => return SessionEnd::Reconnect("gateway fechou a conexão".into()),
            }
        }
    }
}

fn dispatch(value: Value, event_tx: &EventTx, voice_tx: &UnboundedSender<Wire>, session_id: &str) {
    let kind = value.get("t").and_then(Value::as_str).unwrap_or("");
    log::debug!("gateway dispatch: {kind}");
    let Some(data) = value.get("d").cloned() else {
        return;
    };
    match kind {
        "READY" => {
            let user = data.pointer("/user").cloned().unwrap_or(Value::Null);
            if let Ok(user) = serde_json::from_value::<User>(user) {
                event_tx.send(UiEvent::Ready { user });
            }
            // User-account READY carries per-guild voice states; seed the
            // sidebar roster with them (empty list clears stale state).
            if let Some(guilds) = data.get("guilds").and_then(Value::as_array) {
                for guild in guilds {
                    let Some(id) = guild.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let states = guild
                        .get("voice_states")
                        .cloned()
                        .and_then(|states| serde_json::from_value::<Vec<VoiceState>>(states).ok())
                        .unwrap_or_default();
                    let _ = event_tx.send(UiEvent::GuildVoiceStates {
                        guild_id: id.to_string(),
                        states,
                    });
                }
            }
        }
        "MESSAGE_CREATE" => {
            if let Ok(message) = serde_json::from_value::<Message>(data) {
                let _ = event_tx.send(UiEvent::MessageCreated { message });
            }
        }
        "MESSAGE_UPDATE" => {
            if let Ok(patch) = serde_json::from_value::<MessagePatch>(data) {
                if let Some(content) = patch.content {
                    let _ = event_tx.send(UiEvent::MessageUpdated {
                        channel_id: patch.channel_id,
                        message_id: patch.id,
                        content,
                    });
                }
            }
        }
        "MESSAGE_DELETE" => {
            let channel_id = data.get("channel_id").and_then(Value::as_str);
            let message_id = data.get("id").and_then(Value::as_str);
            if let (Some(channel_id), Some(message_id)) = (channel_id, message_id) {
                let _ = event_tx.send(UiEvent::MessageDeleted {
                    channel_id: channel_id.to_string(),
                    message_id: message_id.to_string(),
                });
            }
        }
        "TYPING_START" => {
            let channel_id = data.get("channel_id").and_then(Value::as_str);
            let user_id = data.get("user_id").and_then(Value::as_str);
            if let (Some(channel_id), Some(user_id)) = (channel_id, user_id) {
                let _ = event_tx.send(UiEvent::TypingStart {
                    channel_id: channel_id.to_string(),
                    user_id: user_id.to_string(),
                });
            }
        }
        "PRESENCE_UPDATE" => {
            let user_id = data.pointer("/user/id").and_then(Value::as_str);
            let status = data.get("status").and_then(Value::as_str);
            if let (Some(user_id), Some(status)) = (user_id, status) {
                let _ = event_tx.send(UiEvent::PresenceUpdate {
                    user_id: user_id.to_string(),
                    status: status.to_string(),
                });
            }
        }
        "VOICE_STATE_UPDATE" => match serde_json::from_value::<VoiceStatePayload>(data) {
            Ok(payload) => {
                log::info!(
                    "VOICE_STATE_UPDATE: user={} canal={:?} guild={:?} sessão={:?}",
                    payload.state.user_id,
                    payload.state.channel_id,
                    payload.state.guild_id,
                    payload.state.session_id
                );
                // Guild voice states embed the member; harvest the user for
                // the roster names.
                if let Some(user) = payload.member.map(|member| member.user) {
                    let _ = event_tx.send(UiEvent::UserResolved { user });
                }
                let _ = event_tx.send(UiEvent::VoiceStateUpdate {
                    state: payload.state.clone(),
                });
                let _ = voice_tx.send(Wire::State(payload.state));
            }
            Err(err) => log::warn!("VOICE_STATE_UPDATE não parseou: {err}"),
        },
        "VOICE_SERVER_UPDATE" => {
            let guild_id = data.get("guild_id").and_then(Value::as_str);
            let endpoint = data.get("endpoint").and_then(Value::as_str);
            let token = data.get("token").and_then(Value::as_str);
            log::info!(
                "VOICE_SERVER_UPDATE: guild={guild_id:?} endpoint={endpoint:?} token={}",
                token.is_some()
            );
            if let (Some(guild_id), Some(endpoint), Some(token)) = (guild_id, endpoint, token) {
                let _ = voice_tx.send(Wire::Server {
                    guild_id: guild_id.to_string(),
                    endpoint: endpoint.to_string(),
                    token: token.to_string(),
                    session_id: session_id.to_string(),
                });
            }
        }
        _ => {}
    }
}

#[derive(serde::Deserialize)]
struct MessagePatch {
    id: String,
    channel_id: String,
    #[serde(default)]
    content: Option<String>,
}

/// VOICE_STATE_UPDATE as Discord sends it for guilds, with the embedded
/// member (user account payloads only).
#[derive(serde::Deserialize)]
struct VoiceStatePayload {
    #[serde(flatten)]
    state: VoiceState,
    #[serde(default)]
    member: Option<VoiceMember>,
}

#[derive(serde::Deserialize)]
struct VoiceMember {
    user: User,
}

fn identify_payload(token: &str) -> String {
    // `intents` is required by the protocol. 0 selects no bot-only intents,
    // but GUILD_VOICE_STATES (1 << 25) must be set: without it Discord does
    // not deliver VOICE_STATE_UPDATE, which the voice handshake depends on
    // for our own session id (docs/VOICE.md).
    const GUILD_VOICE_STATES: i64 = 1 << 25;
    json!({
        "op": 2,
        "d": {
            "token": token,
            "intents": GUILD_VOICE_STATES,
            "properties": {
                "os": std::env::consts::OS,
                "browser": "FastDiscord",
                "device": "FastDiscord"
            },
            "presence": { "status": "online", "afk": false }
        }
    })
    .to_string()
}

async fn handle_command(api: &Api, command: Command, event_tx: &EventTx, write: &mut WsSink) {
    match command {
        Command::LoadGuilds => match api.guilds().await {
            Ok(guilds) => {
                let _ = event_tx.send(UiEvent::GuildsLoaded { guilds });
            }
            Err(err) => report(api, err, event_tx, "carregar servidores").await,
        },
        Command::LoadDmChannels => match api.dm_channels().await {
            Ok(channels) => {
                let _ = event_tx.send(UiEvent::DmChannelsLoaded { channels });
            }
            Err(err) => report(api, err, event_tx, "carregar mensagens diretas").await,
        },
        Command::LoadGuildChannels { guild_id } => match api.guild_channels(&guild_id).await {
            Ok(channels) => {
                let _ = event_tx.send(UiEvent::GuildChannelsLoaded { guild_id, channels });
            }
            Err(err) => report(api, err, event_tx, "carregar canais").await,
        },
        Command::LoadMessages { channel_id, before } => {
            match api.messages(&channel_id, before.as_deref()).await {
                Ok(messages) => {
                    let _ = event_tx.send(UiEvent::MessagesLoaded {
                        older: before.is_some(),
                        channel_id,
                        messages,
                    });
                }
                Err(err) => report(api, err, event_tx, "carregar mensagens").await,
            }
        }
        Command::SendMessage {
            channel_id,
            content,
        } => match api.send_message(&channel_id, &content).await {
            Ok(message) => {
                let _ = event_tx.send(UiEvent::MessageCreated { message });
            }
            Err(err) => {
                let _ = event_tx.send(UiEvent::SendFailed {
                    channel_id,
                    error: err.to_string(),
                });
            }
        },
        Command::SendTyping { channel_id } => {
            if let Err(err) = api.send_typing(&channel_id).await {
                log::warn!("falha ao avisar digitação: {err}");
            }
        }
        Command::JoinVoice {
            guild_id,
            channel_id,
            self_mute,
            self_deaf,
        } => {
            log::info!("enviando op 4: guild={guild_id} canal={channel_id}");
            let payload = json!({
                "op": 4,
                "d": {
                    "guild_id": guild_id,
                    "channel_id": channel_id,
                    "self_mute": self_mute,
                    "self_deaf": self_deaf,
                }
            });
            if let Err(err) = write.send(WsMessage::text(payload.to_string())).await {
                log::warn!("falha ao pedir entrada no canal de voz: {err}");
            }
        }
        Command::LeaveVoice { guild_id } => {
            let payload = json!({
                "op": 4,
                "d": {
                    "guild_id": guild_id,
                    "channel_id": Value::Null,
                    "self_mute": false,
                    "self_deaf": false,
                }
            });
            if let Err(err) = write.send(WsMessage::text(payload.to_string())).await {
                log::warn!("falha ao sair do canal de voz: {err}");
            }
        }
        Command::LoadVoiceUser { guild_id, user_id } => {
            match api.guild_member(&guild_id, &user_id).await {
                Ok(member) => {
                    let _ = event_tx.send(UiEvent::UserResolved { user: member.user });
                }
                Err(err) => log::warn!("falha ao carregar membro {user_id}: {err}"),
            }
        }
    }
}

/// Surfaces REST failures to the UI, treating an expired token specially.
async fn report(api: &Api, err: ApiError, event_tx: &EventTx, context: &str) {
    if matches!(err, ApiError::Unauthorized)
        && matches!(api.me().await, Err(ApiError::Unauthorized))
    {
        let _ = event_tx.send(UiEvent::TokenInvalid);
    }
    let _ = event_tx.send(UiEvent::Error {
        context: format!("{context}: {err}"),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// VOICE_STATE_UPDATE real shape: flattened state + embedded member.
    #[test]
    fn voice_state_update_parses_with_member() {
        let data = serde_json::json!({
            "guild_id": "914890968354918401",
            "channel_id": "914890968354918404",
            "user_id": "111111111111111111",
            "session_id": "e4b3f5a1c9d2",
            "deaf": false,
            "mute": false,
            "self_deaf": false,
            "self_mute": false,
            "suppress": false,
            "member": {
                "user": { "id": "111111111111111111", "username": "fulano" },
                "roles": ["914890968354918400"]
            }
        });
        let payload: VoiceStatePayload = serde_json::from_value(data).expect("deve parsear");
        assert_eq!(payload.state.user_id, "111111111111111111");
        assert_eq!(payload.state.session_id, "e4b3f5a1c9d2");
        assert_eq!(
            payload.state.guild_id.as_deref(),
            Some("914890968354918401")
        );
    }
}
