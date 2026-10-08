use super::*;
use bytes::Bytes;
use std::collections::VecDeque;
use tracing::trace;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredPacket {
    pub packet: Bytes,
    // We need to store this as it's possible that a user can change config modes.
    pub decrypted: bool,
}

/// Determines whether an SSRC's packets should be decoded.
///
/// Playout requires us to keep an almost constant delay, to do so we build
/// a user's packet buffer up to the required length ([`Config::playout_buffer_length`])
/// ([`Self::Fill`]) and then emit packets on each tick ([`Self::Drain`]).
///
/// This gets a bit harder to reason about when users stop speaking. If a speech gap
/// lasts longer than the playout buffer, then we can simply swap from `Drain` -> `Fill`.
/// However, a genuine gap of `n` frames must lead to us reverting to `Fill` for `n` frames.
/// To compute this, we use the RTP timestamp of two `seq`-adjacent packets at playout: if the next
/// timestamp is too large, then we revert to `Fill`.
///
/// Small playout bursts also require care.
///
/// If timestamp info is incorrect, then in the worst case we eventually need to rebuffer if the delay
/// drains to zero.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PlayoutMode {
    Fill,
    Drain,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PacketLookup {
    Packet(StoredPacket),
    MissedPacket,
    Filling,
}

#[derive(Debug)]
pub struct PlayoutBuffer {
    buffer: VecDeque<Option<StoredPacket>>,
    playout_mode: PlayoutMode,
    next_seq: RtpSequence,
    current_timestamp: Option<RtpTimestamp>,
    consecutive_store_fails: usize,
}

impl PlayoutBuffer {
    pub fn new(capacity: usize, next_seq: RtpSequence) -> Self {
        Self {
            buffer: VecDeque::with_capacity(capacity),
            playout_mode: PlayoutMode::Fill,
            next_seq,
            current_timestamp: None,
            consecutive_store_fails: 0,
        }
    }

    /// Slot a received RTP packet into the correct location in the playout buffer using
    /// its sequence number, subject to maximums.
    ///
    /// An out of bounds packet must create any remaining `None`s
    pub fn store_packet(&mut self, packet: StoredPacket, config: &Config) {
        let rtp = RtpPacket::new(&packet.packet)
            .expect("FATAL: earlier valid packet now invalid (store)");

        if self.current_timestamp.is_none() {
            self.current_timestamp = Some(reset_timeout(&rtp, config));
        }

        // compute index by taking wrapping difference between both seq numbers.
        // If the difference is *too big*, or in the past [also too big, in a way],
        // ignore the packet
        let pkt_seq = rtp.get_sequence().0;
        let desired_index = (pkt_seq - self.next_seq).0 as i16;

        // Similar concept to fetch_packet -- if there's a critical desync, and we're unwilling
        // to slot this packet into an empty/stuck buffer then behave as though this packet is the next
        // sequence number we're releasing.
        let err_threshold = i16::from(config.playout_buffer_length.get() * 5);
        let handling_desync = (self.buffer.is_empty()
            || self.consecutive_store_fails >= (err_threshold as usize))
            && desired_index >= err_threshold;

        if desired_index < 0 {
            trace!("Missed packet arrived late, discarding from playout.");
        } else if !handling_desync && desired_index >= 64 {
            trace!(
                "Packet arrived beyond playout max length({}): wanted slot {desired_index}.\
                ts {}, seq {}, next_out_seq {}",
                rtp.get_ssrc(),
                rtp.get_timestamp().0,
                rtp.get_sequence().0,
                self.next_seq,
            );
            self.consecutive_store_fails += 1;
        } else {
            let index = if handling_desync {
                self.buffer.clear();
                self.next_seq = pkt_seq;

                0
            } else {
                desired_index as usize
            };
            while self.buffer.len() <= index {
                self.buffer.push_back(None);
            }
            self.buffer[index] = Some(packet);
            self.consecutive_store_fails = 0;
        }

        if self.buffer.len() >= usize::from(config.playout_buffer_length.get()) {
            self.playout_mode = PlayoutMode::Drain;
        }
    }

    pub fn fetch_packet(&mut self, config: &Config) -> PacketLookup {
        if self.playout_mode == PlayoutMode::Fill {
            return PacketLookup::Filling;
        }

        let out = match self.buffer.pop_front() {
            Some(Some(pkt)) => {
                let rtp = RtpPacket::new(&pkt.packet)
                    .expect("FATAL: earlier valid packet now invalid (fetch)");

                // The curr_ts captures the current playout point; we want to
                // be able to emit *all* packets with a smaller timestamp.
                // However, we need to handle this in a wrap-safe way.
                // ts_diff shows where the current time lies if we treat packet_ts
                // as 0, s.t. ts_diff >= 0 (equiv) packet_time <= curr_time.
                let curr_ts = self.current_timestamp.as_mut().unwrap();
                let pkt_ts = rtp.get_timestamp().0;
                let ts_diff = (*curr_ts - pkt_ts).0 as i32;

                // At least one client in the wild has seen unusual timestamp behaviour: the
                // first packet sent out in a run of audio may have an older timestamp.
                // This could be badly timestamped, or could conceivably be an orphaned packet
                // from a prior run, or e.g.:
                //  (n x RTP) -> [>100ms delay] -> (RTP) -> [long O(s) delay] -> (m x RTP)
                // This leaves us with two adjacent packets in the same playout with wildly varying
                // timestamps. We have a slightly tricky situation -- we need to preserve accurate
                // timing to correctly drain/refill/recreate very small pauses in audio, but don't
                // want to block indefinitely.
                //
                // We have a compromise here -- if an adjacent (Drain) packet has a ts gap
                // larger than it would take to go through multiple Fill/Drain cycles, then
                // treat its TS as the next expected value to avoid jamming the buffer and losing
                // later audio.
                let skip_after = i32::try_from(
                    usize::from(config.playout_buffer_length.get()) * 5 * MONO_FRAME_SIZE,
                )
                .unwrap_or((AUDIO_FRAME_RATE * 2 * MONO_FRAME_SIZE) as i32);

                if ts_diff >= 0 {
                    // At or before expected timestamp.
                    self.next_seq = (rtp.get_sequence() + 1).0;

                    PacketLookup::Packet(pkt)
                } else if ts_diff <= -skip_after {
                    // >5 playouts ahead.
                    self.next_seq = (rtp.get_sequence() + 1).0;
                    *curr_ts = pkt_ts;
                    PacketLookup::Packet(pkt)
                } else {
                    trace!("Witholding packet: ts_diff is {ts_diff}");
                    self.buffer.push_front(Some(pkt));
                    self.playout_mode = PlayoutMode::Fill;
                    PacketLookup::Filling
                }
            },
            Some(None) => {
                self.next_seq += 1;
                PacketLookup::MissedPacket
            },
            None => PacketLookup::Filling,
        };

        if self.buffer.is_empty() {
            self.playout_mode = PlayoutMode::Fill;
            self.current_timestamp = None;
        }

        if let Some(ts) = self.current_timestamp.as_mut() {
            *ts += &(MONO_FRAME_SIZE as u32);
        }

        out
    }

    pub fn next_seq(&self) -> RtpSequence {
        self.next_seq
    }
}

#[inline]
fn reset_timeout(packet: &RtpPacket<'_>, config: &Config) -> RtpTimestamp {
    let t_shift = MONO_FRAME_SIZE * usize::from(config.playout_buffer_length.get());
    (packet.get_timestamp() + (t_shift as u32)).0
}
