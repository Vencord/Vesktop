mod decode_sizes;
mod playout_buffer;
mod ssrc_state;

use self::{decode_sizes::*, playout_buffer::*, ssrc_state::*};

use super::message::*;
use crate::driver::{CryptoMode, DecodeMode};
use crate::{
    constants::*,
    driver::crypto::Cipher,
    events::{context_data::VoiceTick, internal_data::*, CoreContext},
    Config,
};
use bytes::BytesMut;
use discortp::{
    demux::{self, DemuxedMut},
    rtp::{RtpPacket},
};
use discortp::{MutablePacket, Packet};
use flume::Receiver;
use std::sync::{
    atomic::{AtomicU16, Ordering},
    RwLock,
};
use std::{
    collections::{HashMap, HashSet},
    num::Wrapping,
    sync::Arc,
    time::Duration,
};
use tokio::{net::UdpSocket, select, time::Instant};
use tracing::{instrument, trace, warn};

type RtpSequence = Wrapping<u16>;
type RtpTimestamp = Wrapping<u32>;
type RtpSsrc = u32;

struct UdpRx {
    cipher: Cipher,
    crypto_mode: CryptoMode,
    decoder_map: HashMap<RtpSsrc, SsrcState>,
    config: Config,
    rx: Receiver<UdpRxMessage>,
    ssrc_signalling: Arc<SsrcTracker>,
    udp_socket: UdpSocket,
    dave_session: Arc<RwLock<Option<davey::DaveSession>>>,
    dave_protocol_version: Arc<AtomicU16>,
    /// FastDiscord diagnostics: last DAVE-drop log per SSRC (rate limit).
    dave_drop_log: HashMap<RtpSsrc, Instant>,
}

impl UdpRx {
    #[instrument(skip(self))]
    async fn run(&mut self, interconnect: &mut Interconnect) {
        let mut cleanup_time = Instant::now();
        let mut playout_time = Instant::now() + TIMESTEP_LENGTH;
        let mut byte_dest: Option<BytesMut> = None;

        loop {
            if byte_dest.is_none() {
                byte_dest = Some(BytesMut::zeroed(VOICE_PACKET_MAX));
            }

            select! {
                Ok((len, _addr)) = self.udp_socket.recv_from(byte_dest.as_mut().unwrap()) => {
                    let mut pkt = byte_dest.take().unwrap();
                    pkt.truncate(len);

                    self.process_udp_message(interconnect, pkt).await;
                },
                msg = self.rx.recv_async() => {
                    match msg {
                        Ok(UdpRxMessage::ReplaceInterconnect(i)) => {
                            *interconnect = i;
                        },
                        Ok(UdpRxMessage::SetConfig(new_config)) => {
                            if let DecodeMode::Decode(old_config) = &mut self.config.decode_mode {
                                if *old_config != new_config {
                                    *old_config = new_config;
                                    self.decoder_map.values_mut().for_each(|v| v.reconfigure_decoder(new_config));
                                }
                            }
                        },
                        Err(flume::RecvError::Disconnected) => break,
                    }
                },
                () = tokio::time::sleep_until(playout_time) => {
                    let mut tick = VoiceTick {
                        speaking: HashMap::new(),
                        silent: HashSet::new(),
                    };

                    for (ssrc, state) in &mut self.decoder_map {
                        match state.get_voice_tick(&self.config) {
                            Ok(Some(data)) => {
                                tick.speaking.insert(*ssrc, data);
                            },
                            Ok(None) => {
                                if !state.disconnected {
                                    tick.silent.insert(*ssrc);
                                }
                            },
                            Err(e) => {
                                warn!("Decode error for SSRC {ssrc}: {e:?}");
                                tick.silent.insert(*ssrc);
                            },
                        }
                    }

                    playout_time += TIMESTEP_LENGTH;

                    drop(interconnect.events.send(EventMessage::FireCoreEvent(CoreContext::VoiceTick(tick))));
                },
                () = tokio::time::sleep_until(cleanup_time) => {
                    // periodic cleanup.
                    let now = Instant::now();

                    // check ssrc map to see if the WS task has informed us of any disconnects.
                    loop {
                        // This is structured in an odd way to prevent deadlocks.
                        // while-let seemed to keep the dashmap iter() alive for block scope, rather than
                        // just the initialiser.
                        let id = {
                            if let Some(id) = self.ssrc_signalling.disconnected_users.iter().next().map(|v| *v.key()) {
                                id
                            } else {
                                break;
                            }
                        };

                        _ = self.ssrc_signalling.disconnected_users.remove(&id);
                        if let Some((_, ssrc)) = self.ssrc_signalling.user_ssrc_map.remove(&id) {
                            let _ = self.ssrc_signalling.ssrc_user_map.remove(&ssrc);

                            if let Some(state) = self.decoder_map.get_mut(&ssrc) {
                                // don't cleanup immediately: leave for later cycle
                                // this is key with reorder/jitter buffers where we may
                                // still need to decode post disconnect for ~0.2s.
                                state.prune_time = now + Duration::from_secs(1);
                                state.disconnected = true;
                            }
                        }
                    }

                    // now remove all dead ssrcs.
                    self.decoder_map.retain(|_, v| v.prune_time > now);

                    cleanup_time = now + Duration::from_secs(5);
                },
            }
        }
    }

    async fn process_udp_message(&mut self, interconnect: &Interconnect, mut packet: BytesMut) {
        // NOTE: errors here (and in general for UDP) are not fatal to the connection.
        // Panics should be avoided due to adversarial nature of rx'd packets,
        // but correct handling should not prompt a reconnect.
        //
        // For simplicity, if the event task fails then we nominate the mixing thread
        // to rebuild their context etc. (hence, the `let _ =` statements.), as it will
        // try to make contact every 20ms.
        let crypto_mode = self.crypto_mode;

        match demux::demux_mut(packet.as_mut()) {
            DemuxedMut::Rtp(mut rtp) => {
                if !rtp_valid(&rtp.to_immutable()) {
                    return;
                }

                let ssrc = rtp.get_ssrc();
                let has_extension = rtp.get_extension() != 0;

                let mut packet_data = if self.config.decode_mode.should_decrypt() {
                    let out = self.cipher.decrypt_rtp_in_place(&mut rtp).map(|(s, t)| {
                        if rtp.get_padding() != 0 {
                            let payload = rtp.payload();
                            let padding_count = payload[payload.len() - t - 1] as usize;
                            (s, t + padding_count, true)
                        } else {
                            (s, t, true)
                        }
                    });

                    if let Err(ref e) = out { warn!("RTP decryption failed: {:?}", e); }
                    out.ok()
                } else {
                    None
                };

                let mut shrinkage = 0;
                let mut should_drop = false;

                if let Some((rtp_body_start, rtp_body_tail, decrypted)) = packet_data {
                    let payload = rtp.payload_mut();
                    let payload_length = payload.len();
                    
                    // FIX: Read extension length from index 2 and 3 of payload (the actual RTP extension header)
                    let mut ext_len = 0;
                    if has_extension && payload.len() >= 4 {
                        let words = u16::from_be_bytes([payload[2], payload[3]]) as usize;
                        ext_len = 4 + (words * 4);
                    }

                    // DAVE Ciphertext starts immediately after the full extension (header + payload)
                    let cipher_start = ext_len;
                    let cipher_end = payload_length.saturating_sub(rtp_body_tail);

                    let dave_version = self.dave_protocol_version.load(Ordering::Relaxed);
                    // FastDiscord patch: E2EE is active when the MLS session
                    // is ready, even if DavePrepareEpoch (which sets the
                    // version) never arrives — Discord sends id=0 bootstrap
                    // commits on join and upstream skips arming them.
                    let dave_active = dave_version != 0
                        || self
                            .dave_session
                            .read()
                            .unwrap()
                            .as_ref()
                            .is_some_and(|s| s.is_ready());

                    if cipher_start < cipher_end {
                        let body = &mut payload[cipher_start..cipher_end];
                        let body_length = body.len();

                        let has_marker = body_length >= 11 && body[body_length - DAVE_MAGIC_MARKER.len()..] == DAVE_MAGIC_MARKER[..];

                        if decrypted && dave_active {
                            if has_marker {
                                let mut decrypted_successfully = false;
                                // FastDiscord diagnostics: why an E2EE frame
                                // is dropped (rate-limited).
                                let mut drop_reason = "sem ratchet";

                                if let Some(user_id) = self.ssrc_signalling.ssrc_user_map.get(&ssrc) {
                                    if let Some(ref mut dave_session) = *self.dave_session.write().unwrap() {
                                        if dave_session.is_ready() {
                                            match dave_session.decrypt(user_id.0, davey::MediaType::AUDIO, body) {
                                                Ok(decrypted_body) => {
                                                    shrinkage = body.len() - decrypted_body.len();
                                                    body[..decrypted_body.len()].copy_from_slice(&decrypted_body);
                                                    decrypted_successfully = true;
                                                },
                                                Err(e) => {
                                                    drop_reason = "decrypt falhou";
                                                    trace!("DAVE decrypt error para ssrc {ssrc}: {e:?}");
                                                }
                                            }
                                        } else {
                                            drop_reason = "sessão MLS não pronta";
                                        }
                                    }
                                } else {
                                    drop_reason = "ssrc sem usuário mapeado";
                                }

                                if !decrypted_successfully {
                                    // Rate-limit: one line per SSRC per 5s.
                                    let now = Instant::now();
                                    let last = self.dave_drop_log.entry(ssrc).or_insert(Instant::now() - Duration::from_secs(10));
                                    if now.duration_since(*last) >= Duration::from_secs(5) {
                                        warn!("frame DAVE descartado (ssrc {ssrc}): {drop_reason}");
                                        *last = now;
                                    }
                                    should_drop = true;
                                }
                            }
                        }
                    }
                    
                    if shrinkage > 0 {
                        // Shift the Transport MAC left to cover the gap left by the stripped DAVE MAC
                        let suffix_start = payload_length - rtp_body_tail;
                        let suffix_end = payload_length;
                        payload.copy_within(suffix_start..suffix_end, suffix_start - shrinkage);
                    }
                    
                    packet_data = Some((rtp_body_start, rtp_body_tail, decrypted));
                }

                if should_drop {
                    return; 
                }

                let (rtp_body_start, rtp_body_tail, decrypted) = packet_data.unwrap_or_else(|| {
                    (
                        crypto_mode.payload_prefix_len(),
                        crypto_mode.payload_suffix_len(),
                        false,
                    )
                });

                drop(rtp);

                if shrinkage > 0 {
                    let new_len = packet.len() - shrinkage;
                    packet.truncate(new_len);
                }

                let rtp_immutable = RtpPacket::new(&packet).unwrap();

                let entry = self
                    .decoder_map
                    .entry(ssrc)
                    .or_insert_with(|| SsrcState::new(&rtp_immutable, crypto_mode, &self.config));

                entry.refresh_timer(self.config.decode_state_timeout.into());

                let store_pkt = StoredPacket {
                    packet: packet.freeze(),
                    decrypted,
                };
                
                let packet_frozen = store_pkt.packet.clone();
                entry.store_packet(store_pkt, &self.config);

                drop(interconnect.events.send(EventMessage::FireCoreEvent(
                    CoreContext::RtpPacket(InternalRtpPacket {
                        packet: packet_frozen,
                        payload_offset: rtp_body_start,
                        payload_end_pad: rtp_body_tail,
                    }),
                )));
            },
            DemuxedMut::Rtcp(mut rtcp) => {
                let packet_data = if self.config.decode_mode.should_decrypt() {
                    let out = self.cipher.decrypt_rtcp_in_place(&mut rtcp);

                    if let Err(ref e) = out {
                        warn!("RTCP decryption failed: {:?}", e);
                    }

                    out.ok()
                } else {
                    None
                };

                let (start, tail) = packet_data.unwrap_or_else(|| {
                    (
                        crypto_mode.payload_prefix_len(),
                        crypto_mode.payload_suffix_len(),
                    )
                });

                drop(interconnect.events.send(EventMessage::FireCoreEvent(
                    CoreContext::RtcpPacket(InternalRtcpPacket {
                        packet: packet.freeze(),
                        payload_offset: start,
                        payload_end_pad: tail,
                    }),
                )));
            },
            DemuxedMut::FailedParse(t) => {
                warn!("Failed to parse message of type {:?}.", t);
            },
            DemuxedMut::TooSmall => {
                warn!("Illegal UDP packet from voice server.");
            },
        }
    }
}

#[instrument(skip(interconnect, rx, cipher))]
pub(crate) async fn runner(
    mut interconnect: Interconnect,
    rx: Receiver<UdpRxMessage>,
    cipher: Cipher,
    crypto_mode: CryptoMode,
    config: Config,
    udp_socket: UdpSocket,
    ssrc_signalling: Arc<SsrcTracker>,
    dave_session: Arc<RwLock<Option<davey::DaveSession>>>,
    dave_protocol_version: Arc<AtomicU16>,
) {
    trace!("UDP receive handle started.");

    let mut state = UdpRx {
        cipher,
        crypto_mode,
        decoder_map: HashMap::new(),
        config,
        rx,
        ssrc_signalling,
        udp_socket,
        dave_session,
        dave_protocol_version,
        dave_drop_log: HashMap::new(),
    };

    state.run(&mut interconnect).await;

    trace!("UDP receive handle stopped.");
}

#[inline]
fn rtp_valid(packet: &RtpPacket<'_>) -> bool {
    packet.get_version() == RTP_VERSION && packet.get_payload_type() == RTP_PROFILE_TYPE
}
