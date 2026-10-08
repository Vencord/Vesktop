use super::message::*;
use crate::{
    driver::tasks::error::DaveReinitError,
    events::CoreContext,
    model::{
        payload::{Heartbeat, Speaking},
        CloseCode as VoiceCloseCode,
        Event as GatewayEvent,
        FromPrimitive,
        SpeakingState,
    },
    ws::{Error as WsError, WsStream},
    ConnectionInfo,
};
use flume::Receiver;
use rand::{distr::Uniform, Rng};
use serenity_voice_model::{
    id::UserId,
    payload::{
        DaveMlsCommitWelcome,
        DaveMlsInvalidCommitWelcome,
        DaveMlsKeyPackage,
        DaveMlsProposalsOperationType,
        DaveTransitionReady,
    },
};
use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU16,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc,
        RwLock,
    },
    time::Duration,
};
use tokio::{
    select,
    time::{sleep_until, Instant},
};
#[cfg(feature = "tungstenite")]
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tracing::{debug, info, instrument, trace, warn};

pub(crate) struct AuxNetwork {
    rx: Receiver<WsMessage>,
    ws_client: WsStream,
    dont_send: bool,

    ssrc: u32,
    heartbeat_interval: Duration,

    speaking: SpeakingState,
    last_heartbeat_nonce: Option<u64>,

    attempt_idx: usize,
    info: ConnectionInfo,

    dave_session: Arc<RwLock<Option<davey::DaveSession>>>,
    dave_protocol_version: Arc<AtomicU16>,
    dave_pending_transitions: HashMap<u16, u16>,
    recognized_user_ids: HashSet<UserId>,

    #[cfg(feature = "receive")]
    ssrc_signalling: Arc<SsrcTracker>,
}

impl AuxNetwork {
    pub(crate) fn new(
        evt_rx: Receiver<WsMessage>,
        ws_client: WsStream,
        ssrc: u32,
        heartbeat_interval: f64,
        attempt_idx: usize,
        info: ConnectionInfo,
        dave_session: Arc<RwLock<Option<davey::DaveSession>>>,
        dave_protocol_version: Arc<AtomicU16>,
        #[cfg(feature = "receive")] ssrc_signalling: Arc<SsrcTracker>,
    ) -> Self {
        let mut recognized_user_ids = HashSet::new();

        recognized_user_ids.insert(info.user_id.into());

        Self {
            rx: evt_rx,
            ws_client,
            dont_send: false,

            ssrc,
            heartbeat_interval: Duration::from_secs_f64(heartbeat_interval / 1000.0),

            speaking: SpeakingState::empty(),
            last_heartbeat_nonce: None,

            attempt_idx,
            info,

            dave_session,
            dave_protocol_version,
            dave_pending_transitions: HashMap::new(),
            recognized_user_ids,

            #[cfg(feature = "receive")]
            ssrc_signalling,
        }
    }

    #[instrument(skip(self))]
    async fn run(&mut self, interconnect: &mut Interconnect) {
        let mut next_heartbeat = Instant::now() + self.heartbeat_interval;

        loop {
            let mut ws_error = false;
            let mut should_reconnect = false;
            let mut ws_reason = None;

            let hb = sleep_until(next_heartbeat);

            select! {
                // Biased polling (polling from top to bottom) is needed to process WebSocket events
                // queued in the initial handshake (messages before SessionDescription). One of the
                // events queued is ClientsConnect, which is needed to correctly keep track of
                // recognized_user_ids and to correctly process DaveMlsProposals.
                biased;

                () = hb => {
                    ws_error = match self.send_heartbeat().await {
                        Err(e) => {
                            should_reconnect = ws_error_is_not_final(&e);
                            ws_reason = Some((&e).into());
                            true
                        },
                        _ => false,
                    };
                    next_heartbeat = self.next_heartbeat();
                }
                inner_msg = self.rx.recv_async() => {
                    match inner_msg {
                        Ok(WsMessage::Ws(data)) => {
                            self.ws_client = *data;
                            next_heartbeat = self.next_heartbeat();
                            self.dont_send = false;
                        },
                        Ok(WsMessage::ReplaceInterconnect(i)) => {
                            *interconnect = i;
                        },
                        Ok(WsMessage::SetKeepalive(keepalive)) => {
                            self.heartbeat_interval = Duration::from_secs_f64(keepalive / 1000.0);
                            next_heartbeat = self.next_heartbeat();
                        },
                        Ok(WsMessage::SetRecognizedUsers(users)) => {
                            // FastDiscord patch: merge the client-known
                            // roster into the MLS-recognized set.
                            self.recognized_user_ids.extend(users);
                        },
                        Ok(WsMessage::Speaking(is_speaking)) => {
                            if self.speaking.contains(SpeakingState::MICROPHONE) != is_speaking && !self.dont_send {
                                self.speaking.set(SpeakingState::MICROPHONE, is_speaking);
                                info!("Changing to {:?}", self.speaking);

                                let ssu_status = self.ws_client
                                    .send_json(&GatewayEvent::from(Speaking {
                                        delay: Some(0),
                                        speaking: self.speaking,
                                        ssrc: self.ssrc,
                                        user_id: None,
                                    }))
                                    .await;

                                ws_error |= match ssu_status {
                                    Err(e) => {
                                        should_reconnect = ws_error_is_not_final(&e);
                                        ws_reason = Some((&e).into());
                                        true
                                    },
                                    _ => false,
                                }
                            }
                        },
                        Ok(WsMessage::Deliver(msg)) => {
                            ws_error |= match self.process_ws(interconnect, msg).await {
                                Err(e) => {
                                    should_reconnect = ws_error_is_not_final(&e);
                                    ws_reason = Some((&e).into());
                                    true
                                }
                                _ => false,
                            }
                        },
                        Err(flume::RecvError::Disconnected) => {
                            break;
                        },
                    }
                }
                ws_msg = self.ws_client.recv_event_no_timeout(), if !self.dont_send => {
                    ws_error = match ws_msg {
                        Err(e) => {
                            should_reconnect = ws_error_is_not_final(&e);
                            ws_reason = Some((&e).into());
                            true
                        },
                        Ok(Some(msg)) => {
                            match self.process_ws(interconnect, msg).await {
                                Err(e) => {
                                    should_reconnect = ws_error_is_not_final(&e);
                                    ws_reason = Some((&e).into());
                                    true
                                },
                                _ => false
                            }
                        },
                        _ => false,
                    };
                }
            }

            if ws_error {
                self.dont_send = true;

                if should_reconnect {
                    drop(interconnect.core.send(CoreMessage::Reconnect));
                } else {
                    drop(interconnect.core.send(CoreMessage::SignalWsClosure(
                        self.attempt_idx,
                        self.info.clone(),
                        ws_reason,
                    )));
                    break;
                }
            }
        }
    }

    fn next_heartbeat(&self) -> Instant {
        Instant::now() + self.heartbeat_interval
    }

    async fn send_heartbeat(&mut self) -> Result<(), WsError> {
        // Discord have suddenly, mysteriously, started rejecting
        // ints-as-strings. Keep JS happy here, I suppose...
        const JS_MAX_INT: u64 = (1u64 << 53) - 1;
        let nonce_range =
            Uniform::new(0, JS_MAX_INT).expect("uniform range is finite and nonempty");
        let nonce = rand::rng().sample(nonce_range);
        self.last_heartbeat_nonce = Some(nonce);

        trace!("Sent heartbeat {:?}", self.speaking);

        if !self.dont_send {
            self.ws_client
                .send_json(&GatewayEvent::from(Heartbeat { nonce }))
                .await?;
        }

        Ok(())
    }

    async fn process_ws(
        &mut self,
        interconnect: &Interconnect,
        value: GatewayEvent,
    ) -> Result<(), WsError> {
        match value {
            GatewayEvent::Speaking(ev) => {
                #[cfg(feature = "receive")]
                if let Some(user_id) = &ev.user_id {
                    self.ssrc_signalling.user_ssrc_map.insert(*user_id, ev.ssrc);
                    self.ssrc_signalling.ssrc_user_map.insert(ev.ssrc, *user_id);
                }

                // FastDiscord patch: op 5 carries the user's identity — MLS
                // commits must recognize them or their media stays encrypted
                // forever (upstream #310; user accounts get no op 11).
                if let Some(user_id) = &ev.user_id {
                    self.recognized_user_ids.insert(*user_id);
                }

                drop(interconnect.events.send(EventMessage::FireCoreEvent(
                    CoreContext::SpeakingStateUpdate(ev),
                )));
            },
            GatewayEvent::ClientConnect(ev) => {
                debug!("Received discontinued ClientConnect: {:?}", ev);
            },
            GatewayEvent::ClientDisconnect(ev) => {
                #[cfg(feature = "receive")]
                {
                    self.ssrc_signalling.disconnected_users.insert(ev.user_id);
                }

                self.recognized_user_ids.remove(&ev.user_id);

                drop(interconnect.events.send(EventMessage::FireCoreEvent(
                    CoreContext::ClientDisconnect(ev),
                )));
            },
            GatewayEvent::ClientsConnect(ev) => {
                self.recognized_user_ids.extend(&ev.user_ids);
            },
            GatewayEvent::HeartbeatAck(ev) => {
                if let Some(nonce) = self.last_heartbeat_nonce.take() {
                    if ev.nonce == nonce {
                        trace!("Heartbeat ACK received.");
                    } else {
                        warn!(
                            "Heartbeat nonce mismatch! Expected {}, saw {}.",
                            nonce, ev.nonce
                        );
                    }
                }
            },
            GatewayEvent::DavePrepareTransition(ev) => {
                info!("DAVE: PrepareTransition id={}", ev.transition_id);
                self.dave_pending_transitions
                    .insert(ev.transition_id, ev.protocol_version);

                if ev.transition_id == 0 {
                    self.execute_dave_transition(ev.transition_id);
                } else if ev.protocol_version == 0 {
                    if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
                        dave_session.set_passthrough_mode(true, Some(120));
                    }

                    self.ws_client
                        .send_json(&GatewayEvent::from(DaveTransitionReady {
                            transition_id: ev.transition_id,
                            protocol_version: ev.protocol_version,
                        }))
                        .await?;
                }
            },
            GatewayEvent::DaveExecuteTransition(ev) => {
                info!("DAVE: ExecuteTransition id={}", ev.transition_id);
                self.execute_dave_transition(ev.transition_id);
            },
            GatewayEvent::DavePrepareEpoch(ev) if ev.epoch == 1 => {
                self.dave_protocol_version
                    .store(ev.protocol_version, Ordering::Relaxed);
                match self.reinit_dave_session().await {
                    Err(DaveReinitError::Ws(e)) => return Err(e),
                    Err(e) => {
                        warn!(error = ?e, "failed to reinitialize DAVE session");
                    },
                    _ => {},
                }
            },
            GatewayEvent::DaveMlsExternalSender(ev) => {
                info!("DAVE: ExternalSender recebido");
                if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
                    if let Err(e) = dave_session.set_external_sender(&ev.external_sender) {
                        warn!(error = ?e, "error setting MLS external sender");
                    }
                }
            },
            GatewayEvent::DaveMlsProposals(ev) => {
                info!(
                    "DAVE: Proposals op={} reconhecidos={} propostas={}",
                    match ev.operation_type {
                        DaveMlsProposalsOperationType::Append => "append",
                        DaveMlsProposalsOperationType::Revoke => "revoke",
                    },
                    self.recognized_user_ids.len(),
                    ev.proposals.len()
                );
                let operation_type = match ev.operation_type {
                    DaveMlsProposalsOperationType::Append => davey::ProposalsOperationType::APPEND,
                    DaveMlsProposalsOperationType::Revoke => davey::ProposalsOperationType::REVOKE,
                };
                let result = if let Some(ref mut dave_session) = *self.dave_session.write().unwrap()
                {
                    match dave_session.process_proposals(
                        operation_type,
                        &ev.proposals,
                        Some(
                            &self
                                .recognized_user_ids
                                .iter()
                                .map(|u| u.0)
                                .collect::<Vec<_>>(),
                        ),
                    ) {
                        Ok(result) => result,
                        Err(e) => {
                            warn!(error = ?e, "error processing MLS proposals");
                            None
                        },
                    }
                } else {
                    None
                };

                match result {
                    Some(commit_welcome) => {
                        info!("DAVE: commit+welcome produzido, enviando");
                        self.ws_client
                            .send_binary(&GatewayEvent::from(DaveMlsCommitWelcome {
                                commit: commit_welcome.commit,
                                welcome: commit_welcome.welcome,
                            }))
                            .await?;
                    },
                    None => info!("DAVE: proposals sem commit (outro cliente committer ou grupo não pronto)"),
                }
            },
            GatewayEvent::DaveMlsAnnounceCommitTransition(ev) => {
                info!("DAVE: AnnounceCommitTransition id={}", ev.transition_id);
                let outcome = self.dave_process_commit(&ev.commit_message);
                {
                    let session = self.dave_session.read().unwrap();
                    info!(
                        "DAVE: commit processado: ok={} sessão_pronta={} versão={}",
                        matches!(outcome, Some(Ok(()))),
                        session.as_ref().is_some_and(|s| s.is_ready()),
                        self.dave_protocol_version.load(Ordering::Relaxed)
                    );
                }
                match outcome {
                    Some(Ok(())) if ev.transition_id != 0 => {
                        let protocol_version = self.dave_protocol_version.load(Ordering::Relaxed);

                        self.dave_pending_transitions
                            .insert(ev.transition_id, protocol_version);
                        self.ws_client
                            .send_json(&GatewayEvent::from(DaveTransitionReady {
                                transition_id: ev.transition_id,
                                protocol_version,
                            }))
                            .await?;
                    },
                    Some(Err(e)) => {
                        warn!("MLS commit errored: {e:?}");
                        self.ws_client
                            .send_json(&GatewayEvent::from(DaveMlsInvalidCommitWelcome {
                                transition_id: ev.transition_id,
                            }))
                            .await?;
                        match self.reinit_dave_session().await {
                            Err(DaveReinitError::Ws(e)) => return Err(e),
                            Err(e) => {
                                warn!(error = ?e, "failed to reinitialize DAVE session");
                            },
                            _ => {},
                        }
                    },
                    Some(Ok(())) | None => {},
                }
            },
            GatewayEvent::DaveMlsWelcome(ev) => {
                info!("DAVE: Welcome recebido id={}", ev.transition_id);
                match self.dave_process_welcome(&ev.welcome) {
                Some(Ok(())) if ev.transition_id != 0 => {
                    let protocol_version = self.dave_protocol_version.load(Ordering::Relaxed);

                    self.dave_pending_transitions
                        .insert(ev.transition_id, protocol_version);
                    self.ws_client
                        .send_json(&GatewayEvent::from(DaveTransitionReady {
                            transition_id: ev.transition_id,
                            protocol_version,
                        }))
                        .await?;
                },

                Some(Err(e)) => {
                    warn!("MLS welcome errored: {e:?}");
                    self.ws_client
                        .send_json(&GatewayEvent::from(DaveMlsInvalidCommitWelcome {
                            transition_id: ev.transition_id,
                        }))
                        .await?;
                    match self.reinit_dave_session().await {
                        Err(DaveReinitError::Ws(e)) => return Err(e),
                        Err(e) => {
                            warn!(error = ?e, "failed to reinitialize DAVE session");
                        },
                        _ => {},
                    }
                },
                Some(Ok(())) | None => {},
                }
            },
            other => {
                trace!("Received other websocket data: {:?}", other);
            },
        }

        Ok(())
    }

    fn dave_process_commit(
        &mut self,
        commit_message: &[u8],
    ) -> Option<Result<(), davey::errors::ProcessCommitError>> {
        let mut dave_session_lock = self.dave_session.write().unwrap();
        let dave_session = (*dave_session_lock).as_mut()?;

        Some(dave_session.process_commit(commit_message))
    }

    fn dave_process_welcome(
        &mut self,
        welcome: &[u8],
    ) -> Option<Result<(), davey::errors::ProcessWelcomeError>> {
        let mut dave_session_lock = self.dave_session.write().unwrap();
        let dave_session = (*dave_session_lock).as_mut()?;

        Some(dave_session.process_welcome(welcome))
    }

    async fn reinit_dave_session(&mut self) -> Result<(), DaveReinitError> {
        let protocol_version = self.dave_protocol_version.load(Ordering::Relaxed);

        if let Some(dave_protocol_version) = NonZeroU16::new(protocol_version) {
            let user_id = self.info.user_id.0.into();
            let channel_id = self.info.channel_id.0.into();

            let key_package =
                if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
                    dave_session.reinit(dave_protocol_version, user_id, channel_id, None)?;
                    dave_session.create_key_package()?
                } else {
                    let mut dave_session =
                        davey::DaveSession::new(dave_protocol_version, user_id, channel_id, None)?;
                    let key_package = dave_session.create_key_package()?;

                    *self.dave_session.write().unwrap() = Some(dave_session);

                    key_package
                };

            self.ws_client
                .send_binary(&GatewayEvent::DaveMlsKeyPackage(DaveMlsKeyPackage {
                    key_package,
                }))
                .await?;
        } else if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
            dave_session.reset()?;
            dave_session.set_passthrough_mode(true, Some(10));
        }

        Ok(())
    }

    fn execute_dave_transition(&mut self, transition_id: u16) {
        let Some(new_version) = self.dave_pending_transitions.get(&transition_id).copied() else {
            warn!("Received DaveExecuteTransition for unknown transition ID {transition_id}");
            return;
        };
        let old_version = self.dave_protocol_version.load(Ordering::Relaxed);

        self.dave_protocol_version
            .store(new_version, Ordering::Relaxed);

        // Upgraded from transport-only encryption
        if transition_id > 0 && old_version == 0 && new_version != 0 {
            if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
                dave_session.set_passthrough_mode(true, Some(10));
            }
        }

        self.dave_pending_transitions.remove(&transition_id);
    }
}

#[instrument(skip(interconnect, aux))]
pub(crate) async fn runner(mut interconnect: Interconnect, mut aux: AuxNetwork) {
    trace!("WS thread started.");
    aux.run(&mut interconnect).await;
    trace!("WS thread finished.");
}

fn ws_error_is_not_final(err: &WsError) -> bool {
    match err {
        #[cfg(feature = "tungstenite")]
        WsError::WsClosed(Some(frame)) => match frame.code {
            CloseCode::Library(l) =>
                if let Some(code) = VoiceCloseCode::from_u16(l) {
                    code.should_resume()
                } else {
                    true
                },
            _ => true,
        },
        #[cfg(feature = "tws")]
        WsError::WsClosed(Some(code)) => match (*code).into() {
            code @ 4000..=4999_u16 =>
                if let Some(code) = VoiceCloseCode::from_u16(code) {
                    code.should_resume()
                } else {
                    true
                },
            _ => true,
        },
        e => {
            debug!("Error sending/receiving ws {:?}.", e);
            true
        },
    }
}
