//! QR-code login through Discord's remote auth gateway (v2), the same flow
//! discord.com's login page uses: this client shows a QR, the phone app scans
//! and approves it, and the token comes back encrypted to an RSA keypair
//! that never leaves this process.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt};
use rsa::pkcs8::EncodePublicKey;
use rsa::sha2::{Digest, Sha256};
use rsa::{Oaep, RsaPrivateKey};
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;
use tokio::time::{Instant, interval_at};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};

use super::api::USER_AGENT;
use super::events::{EventTx, UiEvent};

const GATEWAY: &str = "wss://remote-auth-gateway.discord.gg/?v=2";
const LOGIN_URL: &str = "https://discord.com/api/v9/users/@me/remote-auth/login";
const QR_BASE: &str = "https://discord.com/ra/";

/// Runs one QR session and reports its outcome; the UI starts a new one to
/// get a fresh code.
pub async fn run(event_tx: EventTx) {
    let event = match session(&event_tx).await {
        Ok(token) => UiEvent::QrLogin { token },
        // Expiry is routine: Discord rotates the code, so regenerate
        // silently instead of showing an error.
        Err(err) if err.to_string() == EXPIRED => UiEvent::QrExpired,
        Err(err) => UiEvent::QrFailed {
            reason: err.to_string(),
        },
    };
    let _ = event_tx.send(event);
}

/// Message of the error raised when the gateway closes the code's session.
const EXPIRED: &str = "o QR code expirou";

async fn session(event_tx: &EventTx) -> anyhow::Result<String> {
    // 2048-bit keygen is CPU-bound; keep it off the async workers.
    let key = tokio::task::spawn_blocking(|| RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048))
        .await??;
    let public_key = key
        .to_public_key()
        .to_public_key_der()
        .map_err(|err| anyhow::anyhow!("falha ao codificar a chave pública: {err}"))?;
    let decrypt = |encrypted: &str| -> anyhow::Result<Vec<u8>> {
        Ok(key.decrypt(Oaep::new::<Sha256>(), &STANDARD.decode(encrypted)?)?)
    };

    // The gateway rejects connections that don't come from discord.com.
    let mut request = GATEWAY.into_client_request()?;
    request
        .headers_mut()
        .insert("Origin", "https://discord.com".parse()?);
    let (ws, _) = connect_async(request).await?;
    let (mut write, mut read) = ws.split();

    // Replaced by the real interval once HELLO arrives.
    let mut period = Duration::from_millis(41_250);
    let mut heartbeat = interval_at(Instant::now() + period, period);

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                write.send(WsMessage::text(json!({ "op": "heartbeat" }).to_string())).await?;
            }
            frame = read.next() => {
                let text = match frame {
                    Some(Ok(WsMessage::Text(text))) => text,
                    Some(Ok(WsMessage::Close(_))) | None => {
                        anyhow::bail!("{EXPIRED}")
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(err)) => return Err(err.into()),
                };
                let value: Value = serde_json::from_str(&text)?;
                let field = |name: &str| value.get(name).and_then(Value::as_str).unwrap_or_default();
                match field("op") {
                    "hello" => {
                        if let Some(ms) = value.get("heartbeat_interval").and_then(Value::as_u64) {
                            period = Duration::from_millis(ms);
                            heartbeat = interval_at(Instant::now() + period, period);
                        }
                        let init = json!({
                            "op": "init",
                            "encoded_public_key": STANDARD.encode(public_key.as_bytes()),
                        });
                        write.send(WsMessage::text(init.to_string())).await?;
                    }
                    "nonce_proof" => {
                        let nonce = decrypt(field("encrypted_nonce"))?;
                        let proof = URL_SAFE_NO_PAD.encode(Sha256::digest(&nonce));
                        let reply = json!({ "op": "nonce_proof", "proof": proof });
                        write.send(WsMessage::text(reply.to_string())).await?;
                    }
                    "pending_remote_init" => {
                        let _ = event_tx.send(UiEvent::QrReady {
                            url: format!("{QR_BASE}{}", field("fingerprint")),
                        });
                    }
                    "pending_ticket" => {
                        // Decrypts to "id:discriminator:avatar_hash:username".
                        let payload = String::from_utf8(decrypt(field("encrypted_user_payload"))?)?;
                        let mut parts = payload.rsplitn(4, ':');
                        let username = parts.next().unwrap_or_default().to_string();
                        let avatar = match parts.next() {
                            Some(hash) if !hash.is_empty() && hash != "null" => Some(hash.to_string()),
                            _ => None,
                        };
                        let user_id = parts.next().unwrap_or_default().to_string();
                        let _ = event_tx.send(UiEvent::QrScanned {
                            username,
                            user_id,
                            avatar,
                        });
                    }
                    "pending_login" => {
                        let encrypted = redeem_ticket(field("ticket")).await?;
                        return Ok(String::from_utf8(decrypt(&encrypted)?)?);
                    }
                    "cancel" => anyhow::bail!("login cancelado no celular"),
                    _ => {}
                }
            }
        }
    }
}

/// Trades the approved ticket for the token, still encrypted to our key.
async fn redeem_ticket(ticket: &str) -> anyhow::Result<String> {
    #[derive(serde::Deserialize)]
    struct Login {
        encrypted_token: String,
    }
    let resp = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()?
        .post(LOGIN_URL)
        .json(&json!({ "ticket": ticket }))
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("o Discord recusou o login ({status}): {body}");
    }
    Ok(resp.json::<Login>().await?.encrypted_token)
}
