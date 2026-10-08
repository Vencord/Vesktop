#![allow(missing_docs)]

pub(crate) mod disposal;
pub mod error;
mod events;
pub mod message;
pub mod mixer;
#[cfg(feature = "receive")]
pub(crate) mod udp_rx;
pub(crate) mod ws;

use super::connection::{error::Error as ConnectionError, Connection};
use crate::{
    events::{
        context_data::{DisconnectKind, DisconnectReason},
        internal_data::{InternalConnect, InternalDisconnect},
        CoreContext,
    },
    Config,
    ConnectionInfo,
    FloatDuration,
};
use flume::{Receiver, Sender};
use message::*;
use tokio::{spawn, time::sleep as tsleep};
use tracing::{debug, instrument, trace};

pub(crate) fn start(config: Config, rx: Receiver<CoreMessage>, tx: Sender<CoreMessage>) {
    spawn(async move {
        trace!("Driver started.");
        runner(config, rx, tx).await;
        trace!("Driver finished.");
    });
}

fn start_internals(core: Sender<CoreMessage>, config: &Config) -> Interconnect {
    let (evt_tx, evt_rx) = flume::unbounded();
    let (mix_tx, mix_rx) = flume::unbounded();

    spawn(async move {
        trace!("Event processor started.");
        events::runner(evt_rx).await;
        trace!("Event processor finished.");
    });

    let ic = Interconnect {
        core,
        events: evt_tx,
        mixer: mix_tx,
    };

    config.get_scheduler().new_mixer(config, ic.clone(), mix_rx);
    ic
}

#[instrument(skip(rx, tx))]
async fn runner(mut config: Config, rx: Receiver<CoreMessage>, tx: Sender<CoreMessage>) {
    let mut next_config: Option<Config> = None;
    let mut connection: Option<Connection> = None;
    let mut interconnect = start_internals(tx, &config);
    let mut retrying = None;
    let mut attempt_idx = 0;

    while let Ok(msg) = rx.recv_async().await {
        match msg {
            CoreMessage::ConnectWithResult(info, tx) => {
                config = if let Some(new_config) = next_config.take() {
                    drop(
                        interconnect
                            .mixer
                            .send(MixerMessage::SetConfig(new_config.clone())),
                    );
                    new_config
                } else {
                    config
                };

                if connection.as_ref().is_none_or(|conn| conn.info != info) {
                    // Only *actually* reconnect if the conn info changed, or we don't have an
                    // active connection.
                    // This allows the gateway component to keep sending join requests independent
                    // of driver failures.
                    connection = ConnectionRetryData::connect(tx, info, &mut attempt_idx)
                        .attempt(&mut retrying, &interconnect, &config)
                        .await;
                } else {
                    // No reconnection was attempted as there's a valid, identical connection;
                    // tell the outside listener that the operation was a success.
                    drop(tx.send(Ok(())));
                }
            },
            CoreMessage::RetryConnect(retry_idx) => {
                debug!("Retrying idx: {} (vs. {})", retry_idx, attempt_idx);
                if retry_idx == attempt_idx {
                    if let Some(progress) = retrying.take() {
                        connection = progress
                            .attempt(&mut retrying, &interconnect, &config)
                            .await;
                    }
                }
            },
            CoreMessage::Disconnect => {
                let last_conn = connection.take();
                drop(interconnect.mixer.send(MixerMessage::DropConn));
                drop(interconnect.mixer.send(MixerMessage::RebuildEncoder));

                if let Some(conn) = last_conn {
                    drop(interconnect.events.send(EventMessage::FireCoreEvent(
                        CoreContext::DriverDisconnect(InternalDisconnect {
                            kind: DisconnectKind::Runtime,
                            reason: Some(DisconnectReason::Requested),
                            info: conn.info.clone(),
                        }),
                    )));
                }
            },
            CoreMessage::SignalWsClosure(ws_idx, ws_info, mut reason) => {
                // if idx is not a match, quash reason
                // (i.e., prevent users from mistakenly trying to reconnect for an *old* dead conn).
                // if it *is* a match, the conn needs to die!
                // (as the WS channel has truly given up the ghost).
                let conn = if ws_idx == attempt_idx {
                    drop(interconnect.mixer.send(MixerMessage::DropConn));
                    drop(interconnect.mixer.send(MixerMessage::RebuildEncoder));
                    connection.take()
                } else {
                    reason = None;
                    None
                };

                // Conn may have been unset earlier (i.e., in a deliberate disconnect).
                // If so, do not repropagate/repeat the disconnect event.
                if conn.is_some() {
                    drop(interconnect.events.send(EventMessage::FireCoreEvent(
                        CoreContext::DriverDisconnect(InternalDisconnect {
                            kind: DisconnectKind::Runtime,
                            reason,
                            info: ws_info,
                        }),
                    )));
                }
            },
            CoreMessage::SetTrack(s) => {
                drop(interconnect.mixer.send(MixerMessage::SetTrack(s)));
            },
            CoreMessage::AddTrack(s) => {
                drop(interconnect.mixer.send(MixerMessage::AddTrack(s)));
            },
            CoreMessage::SetBitrate(b) => {
                drop(interconnect.mixer.send(MixerMessage::SetBitrate(b)));
            },
            CoreMessage::SetRecognizedUsers(users) => {
                // FastDiscord patch: forward the client-known roster to the
                // live voice WS task (MLS group membership). Without a live
                // connection the call is dropped — the client re-seeds after
                // every connect.
                if let Some(conn) = connection.as_ref() {
                    drop(conn.ws.send(WsMessage::SetRecognizedUsers(users)));
                }
            },
            CoreMessage::SetConfig(mut new_config) => {
                next_config = Some(new_config.clone());

                new_config.make_safe(&config, connection.is_some());

                drop(interconnect.mixer.send(MixerMessage::SetConfig(new_config)));
            },
            CoreMessage::AddEvent(evt) => {
                drop(interconnect.events.send(EventMessage::AddGlobalEvent(evt)));
            },
            CoreMessage::RemoveGlobalEvents => {
                drop(interconnect.events.send(EventMessage::RemoveGlobalEvents));
            },
            CoreMessage::Mute(m) => {
                drop(interconnect.mixer.send(MixerMessage::SetMute(m)));
            },
            CoreMessage::Reconnect => {
                if let Some(mut conn) = connection.take() {
                    // try once: if interconnect, try again.
                    // if still issue, full connect.
                    let info = conn.info.clone();

                    let full_connect = match conn.reconnect(&config).await {
                        Ok(()) => {
                            connection = Some(conn);
                            false
                        },
                        Err(ConnectionError::InterconnectFailure(_)) => {
                            interconnect.restart_volatile_internals();

                            match conn.reconnect(&config).await {
                                Ok(()) => {
                                    connection = Some(conn);
                                    false
                                },
                                _ => true,
                            }
                        },
                        _ => true,
                    };

                    if full_connect {
                        connection = ConnectionRetryData::reconnect(info, &mut attempt_idx)
                            .attempt(&mut retrying, &interconnect, &config)
                            .await;
                    } else if let Some(ref connection) = &connection {
                        drop(interconnect.events.send(EventMessage::FireCoreEvent(
                            CoreContext::DriverReconnect(InternalConnect {
                                info: connection.info.clone(),
                                ssrc: connection.ssrc,
                            }),
                        )));
                    }
                }
            },
            CoreMessage::FullReconnect =>
                if let Some(conn) = connection.take() {
                    let info = conn.info.clone();

                    connection = ConnectionRetryData::reconnect(info, &mut attempt_idx)
                        .attempt(&mut retrying, &interconnect, &config)
                        .await;
                },
            CoreMessage::RebuildInterconnect => {
                interconnect.restart_volatile_internals();
            },
            CoreMessage::Poison => break,
        }
    }

    trace!("Main thread exited");
    interconnect.poison_all();
}

struct ConnectionRetryData {
    flavour: ConnectionFlavour,
    attempts: u8,
    last_wait: Option<FloatDuration>,
    info: ConnectionInfo,
    idx: usize,
}

impl ConnectionRetryData {
    fn connect(
        tx: Sender<Result<(), ConnectionError>>,
        info: ConnectionInfo,
        idx_src: &mut usize,
    ) -> Self {
        Self::base(ConnectionFlavour::Connect(tx), info, idx_src)
    }

    fn reconnect(info: ConnectionInfo, idx_src: &mut usize) -> Self {
        Self::base(ConnectionFlavour::Reconnect, info, idx_src)
    }

    fn base(flavour: ConnectionFlavour, info: ConnectionInfo, idx_src: &mut usize) -> Self {
        *idx_src = idx_src.wrapping_add(1);

        Self {
            flavour,
            attempts: 0,
            last_wait: None,
            info,
            idx: *idx_src,
        }
    }

    async fn attempt(
        mut self,
        attempt_slot: &mut Option<Self>,
        interconnect: &Interconnect,
        config: &Config,
    ) -> Option<Connection> {
        match Connection::new(self.info.clone(), interconnect, config, self.idx).await {
            Ok(connection) => {
                match self.flavour {
                    ConnectionFlavour::Connect(tx) => {
                        // Other side may not be listening: this is fine.
                        drop(tx.send(Ok(())));

                        drop(interconnect.events.send(EventMessage::FireCoreEvent(
                            CoreContext::DriverConnect(InternalConnect {
                                info: connection.info.clone(),
                                ssrc: connection.ssrc,
                            }),
                        )));
                    },
                    ConnectionFlavour::Reconnect => {
                        drop(interconnect.events.send(EventMessage::FireCoreEvent(
                            CoreContext::DriverReconnect(InternalConnect {
                                info: connection.info.clone(),
                                ssrc: connection.ssrc,
                            }),
                        )));
                    },
                }

                Some(connection)
            },
            Err(why) => {
                debug!("Failed to connect for {:?}: {}", self.info.guild_id, why);
                if let Some(t) = config.driver_retry.retry_in(self.last_wait, self.attempts) {
                    let remote_ic = interconnect.clone();
                    let idx = self.idx;

                    spawn(async move {
                        tsleep(t.into()).await;
                        drop(remote_ic.core.send(CoreMessage::RetryConnect(idx)));
                    });

                    self.attempts += 1;
                    self.last_wait = Some(t);

                    debug!(
                        "Retrying connection for {:?} in {}s ({}/{:?})",
                        self.info.guild_id,
                        t.as_secs_f32(),
                        self.attempts,
                        config.driver_retry.retry_limit
                    );

                    *attempt_slot = Some(self);
                } else {
                    let reason = Some(DisconnectReason::from(&why));

                    match self.flavour {
                        ConnectionFlavour::Connect(tx) => {
                            // See above.
                            drop(tx.send(Err(why)));

                            drop(interconnect.events.send(EventMessage::FireCoreEvent(
                                CoreContext::DriverDisconnect(InternalDisconnect {
                                    kind: DisconnectKind::Connect,
                                    reason,
                                    info: self.info,
                                }),
                            )));
                        },
                        ConnectionFlavour::Reconnect => {
                            drop(interconnect.events.send(EventMessage::FireCoreEvent(
                                CoreContext::DriverDisconnect(InternalDisconnect {
                                    kind: DisconnectKind::Reconnect,
                                    reason,
                                    info: self.info,
                                }),
                            )));
                        },
                    }
                }

                None
            },
        }
    }
}

enum ConnectionFlavour {
    Connect(Sender<Result<(), ConnectionError>>),
    Reconnect,
}
