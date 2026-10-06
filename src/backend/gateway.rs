//! Discord Gateway: a persistent WebSocket session with heartbeats,
//! dispatch handling and reconnect-with-backoff. Sessions always re-IDENTIFY
//! after a drop — RESUME is tracked in docs/PORT.md.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use crate::model::Message;
use crate::model::User;

use super::api::{Api, ApiError};
use super::events::{Command, UiEvent};

const MAX_BACKOFF: Duration = Duration::from_secs(30);

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
    event_tx: UnboundedSender<UiEvent>,
) {
    let api = Api::new(token);
    let mut backoff = Duration::from_secs(3);

    loop {
        let end = session(&api, &mut cmd_rx, &event_tx).await;
        match end {
            SessionEnd::Shutdown => break,
            SessionEnd::Fatal(why) => {
                log::error!("gateway session ended fatally: {why}");
                let _ = event_tx.send(UiEvent::Disconnected { reason: why });
                break;
            }
            SessionEnd::Reconnect(why) => {
                log::warn!("gateway session ended: {why}");
                let _ = event_tx.send(UiEvent::Disconnected { reason: why });
            }
        }

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

async fn session(
    api: &Api,
    cmd_rx: &mut UnboundedReceiver<Command>,
    event_tx: &UnboundedSender<UiEvent>,
) -> SessionEnd {
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
    let hello: Value = match hello.to_text().map_err(|err| err.to_string()).and_then(|text| serde_json::from_str(text).map_err(|err| err.to_string())) {
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
                Some(command) => handle_command(api, command, event_tx).await,
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
                            dispatch(value, event_tx);
                        }
                        _ => {}
                    }
                }
                Some(Err(err)) => return SessionEnd::Reconnect(format!("erro no gateway: {err}")),
                None => return SessionEnd::Reconnect("gateway fechou a conexão".into()),
            }
        }
    }
}

fn dispatch(value: Value, event_tx: &UnboundedSender<UiEvent>) {
    let kind = value.get("t").and_then(Value::as_str).unwrap_or("");
    let Some(data) = value.get("d").cloned() else {
        return;
    };
    match kind {
        "READY" => {
            let user = data
                .pointer("/user")
                .cloned()
                .unwrap_or(Value::Null);
            if let Ok(user) = serde_json::from_value::<User>(user) {
                let _ = event_tx.send(UiEvent::Ready { user });
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

fn identify_payload(token: &str) -> String {
    // `intents` is required by the protocol but ignored for user accounts:
    // 0 selects no bot-only intents, and user accounts keep receiving the
    // events they are entitled to, MESSAGE_CONTENT included.
    json!({
        "op": 2,
        "d": {
            "token": token,
            "intents": 0,
            "properties": {
                "os": std::env::consts::OS,
                "browser": "Vesktop",
                "device": "Vesktop"
            },
            "presence": { "status": "online", "afk": false }
        }
    })
    .to_string()
}

async fn handle_command(api: &Api, command: Command, event_tx: &UnboundedSender<UiEvent>) {
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
        Command::LoadMessages { channel_id, before } => match api.messages(&channel_id, before.as_deref()).await {
            Ok(messages) => {
                let _ = event_tx.send(UiEvent::MessagesLoaded {
                    older: before.is_some(),
                    channel_id,
                    messages,
                });
            }
            Err(err) => report(api, err, event_tx, "carregar mensagens").await,
        },
        Command::SendMessage { channel_id, content } => match api.send_message(&channel_id, &content).await {
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
    }
}

/// Surfaces REST failures to the UI, treating an expired token specially.
async fn report(api: &Api, err: ApiError, event_tx: &UnboundedSender<UiEvent>, context: &str) {
    if matches!(err, ApiError::Unauthorized) && matches!(api.me().await, Err(ApiError::Unauthorized)) {
        let _ = event_tx.send(UiEvent::TokenInvalid);
    }
    let _ = event_tx.send(UiEvent::Error {
        context: format!("{context}: {err}"),
    });
}
