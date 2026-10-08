//! RTP for Go Live video (docs/SCREENSHARE.md): Discord's
//! `aead_aes256_gcm_rtpsize` transport encryption and H.264
//! depacketization (RFC 6184). The layout matches songbird's voice path
//! (third_party/songbird `driver/crypto.rs`): the fixed header, CSRCs and
//! the 4-byte extension preamble are clear and authenticated; extension
//! elements and payload are encrypted, followed by a 16-byte tag and a
//! 4-byte nonce counter (the first 4 bytes of the 12-byte GCM nonce).

use aes_gcm::aead::AeadInPlace;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, Tag};

const TAG_LEN: usize = 16;
const NONCE_LEN: usize = 4;

pub struct Cipher(Aes256Gcm);

/// A decrypted RTP packet: the header fields we use and its payload, with
/// the (decrypted) header extension elements already skipped.
#[derive(Debug, PartialEq)]
pub struct Rtp {
    pub payload_type: u8,
    pub marker: bool,
    pub sequence: u16,
    pub timestamp: u32,
    pub ssrc: u32,
    pub payload: Vec<u8>,
}

impl Cipher {
    pub fn new(key: &[u8]) -> Option<Self> {
        Aes256Gcm::new_from_slice(key).ok().map(Self)
    }

    /// Decrypts one RTP packet; `None` for RTCP, short or forged packets.
    pub fn open_rtp(&self, packet: &[u8]) -> Option<Rtp> {
        if packet.len() < 12 || packet[0] >> 6 != 2 {
            return None;
        }
        // RTCP (SR, RR, PLI…) shares the socket: its type byte is 192..=223.
        if (192..=223).contains(&packet[1]) {
            return None;
        }
        let payload_type = packet[1] & 0x7F;
        let csrcs = usize::from(packet[0] & 0x0F);
        let extension = packet[0] & 0x10 != 0;
        let clear = 12 + 4 * csrcs + if extension { 4 } else { 0 };
        if packet.len() < clear + TAG_LEN + NONCE_LEN {
            return None;
        }
        let (aad, rest) = packet.split_at(clear);
        let (sealed, nonce) = rest.split_at(rest.len() - NONCE_LEN);
        let (body, tag) = sealed.split_at(sealed.len() - TAG_LEN);
        let mut full_nonce = Nonce::default();
        full_nonce[..NONCE_LEN].copy_from_slice(nonce);
        let mut payload = body.to_vec();
        self.0
            .decrypt_in_place_detached(&full_nonce, aad, &mut payload, Tag::from_slice(tag))
            .ok()?;
        if extension {
            // Preamble: 2 bytes profile, 2 bytes length in 32-bit words.
            let words = usize::from(u16::from_be_bytes([aad[clear - 2], aad[clear - 1]]));
            if payload.len() < words * 4 {
                return None;
            }
            payload.drain(..words * 4);
        }
        // P bit: the last (decrypted) byte counts the padding.
        if packet[0] & 0x20 != 0 {
            let pad = usize::from(*payload.last()?);
            payload.truncate(payload.len().checked_sub(pad)?);
        }
        Some(Rtp {
            payload_type,
            marker: packet[1] & 0x80 != 0,
            sequence: u16::from_be_bytes([packet[2], packet[3]]),
            timestamp: u32::from_be_bytes([packet[4], packet[5], packet[6], packet[7]]),
            ssrc: u32::from_be_bytes([packet[8], packet[9], packet[10], packet[11]]),
            payload,
        })
    }

    /// Encrypts in place the inverse of `open_rtp`: `clear` bytes of header
    /// (and extension preamble) stay readable; appends tag and `counter`.
    pub fn seal(&self, packet: &mut Vec<u8>, clear: usize, counter: u32) -> Option<()> {
        let mut full_nonce = Nonce::default();
        full_nonce[..NONCE_LEN].copy_from_slice(&counter.to_be_bytes());
        let (aad, body) = packet.split_at_mut(clear);
        let tag = self.0.encrypt_in_place_detached(&full_nonce, aad, body).ok()?;
        packet.extend_from_slice(&tag);
        packet.extend_from_slice(&counter.to_be_bytes());
        Some(())
    }
}

/// RTCP keyframe request (PLI, RFC 4585): `ours` asks `media` for an IDR.
/// Only the 8-byte header stays clear.
pub fn pli(cipher: &Cipher, ours: u32, media: u32, counter: u32) -> Option<Vec<u8>> {
    let mut packet = vec![0x81, 206, 0, 2];
    packet.extend_from_slice(&ours.to_be_bytes());
    packet.extend_from_slice(&media.to_be_bytes());
    cipher.seal(&mut packet, 8, counter)?;
    Some(packet)
}

/// Empty RTCP Receiver Report: says we're here and keeps the UDP mapping
/// alive while no media flows.
pub fn receiver_report(cipher: &Cipher, ours: u32, counter: u32) -> Option<Vec<u8>> {
    let mut packet = vec![0x80, 201, 0, 1];
    packet.extend_from_slice(&ours.to_be_bytes());
    cipher.seal(&mut packet, 8, counter)?;
    Some(packet)
}

const START_CODE: [u8; 4] = [0, 0, 0, 1];

/// Reassembles H.264 RTP payloads into Annex-B access units.
#[derive(Default)]
pub struct H264Depacketizer {
    frame: Vec<u8>,
    timestamp: Option<u32>,
    next_sequence: Option<u16>,
    /// A packet of the current frame went missing: drop it whole.
    broken: bool,
}

impl H264Depacketizer {
    /// Feeds one packet; returns a finished access unit (Annex B) when the
    /// marker bit closes it. Frames with a sequence gap are dropped; the
    /// caller learns about it through `Err(())` and should ask for a
    /// keyframe.
    pub fn push(&mut self, rtp: &Rtp) -> Result<Option<Vec<u8>>, ()> {
        let mut lost = false;
        if let Some(expected) = self.next_sequence
            && rtp.sequence != expected
        {
            lost = true;
        }
        self.next_sequence = Some(rtp.sequence.wrapping_add(1));
        // A new timestamp without a marker on the old frame: it was cut.
        if self.timestamp.is_some_and(|ts| ts != rtp.timestamp) {
            self.frame.clear();
            self.broken = false;
        }
        self.timestamp = Some(rtp.timestamp);
        if lost {
            self.broken = true;
        }
        self.append(&rtp.payload);
        if !rtp.marker {
            return if lost { Err(()) } else { Ok(None) };
        }
        let frame = std::mem::take(&mut self.frame);
        self.timestamp = None;
        if std::mem::take(&mut self.broken) || frame.is_empty() {
            return Err(());
        }
        Ok(Some(frame))
    }

    fn append(&mut self, payload: &[u8]) {
        let Some(&first) = payload.first() else {
            return;
        };
        match first & 0x1F {
            // Single NAL unit.
            1..=23 => {
                self.frame.extend_from_slice(&START_CODE);
                self.frame.extend_from_slice(payload);
            }
            // STAP-A: 16-bit size-prefixed NAL units.
            24 => {
                let mut rest = &payload[1..];
                while rest.len() >= 2 {
                    let size = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
                    if rest.len() < 2 + size {
                        self.broken = true;
                        break;
                    }
                    self.frame.extend_from_slice(&START_CODE);
                    self.frame.extend_from_slice(&rest[2..2 + size]);
                    rest = &rest[2 + size..];
                }
            }
            // FU-A: one NAL split across packets.
            28 if payload.len() >= 2 => {
                let header = payload[1];
                if header & 0x80 != 0 {
                    self.frame.extend_from_slice(&START_CODE);
                    self.frame.push((first & 0xE0) | (header & 0x1F));
                }
                self.frame.extend_from_slice(&payload[2..]);
            }
            _ => self.broken = true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(marker: bool, sequence: u16, timestamp: u32, payload: &[u8]) -> Rtp {
        Rtp {
            payload_type: 105,
            marker,
            sequence,
            timestamp,
            ssrc: 7,
            payload: payload.to_vec(),
        }
    }

    #[test]
    fn sealed_packet_with_extension_opens() {
        let cipher = Cipher::new(&[9u8; 32]).unwrap();
        // V=2, X=1; marker + PT 105; seq 1; ts 2; ssrc 3; preamble BEDE,
        // 1 word of extension; then that word and the payload (encrypted).
        let mut bytes = vec![0x90, 0x80 | 105, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0xBE, 0xDE, 0, 1];
        bytes.extend_from_slice(&[0x50, 1, 0, 0]);
        bytes.extend_from_slice(b"frame");
        cipher.seal(&mut bytes, 16, 42).unwrap();
        let rtp = cipher.open_rtp(&bytes).unwrap();
        assert_eq!(rtp, Rtp {
            payload_type: 105,
            marker: true,
            sequence: 1,
            timestamp: 2,
            ssrc: 3,
            payload: b"frame".to_vec(),
        });
        // Tampering with the clear header breaks authentication.
        bytes[3] = 9;
        assert!(cipher.open_rtp(&bytes).is_none());
        // RTCP shares the socket and is never taken for RTP.
        assert!(cipher.open_rtp(&pli(&cipher, 1, 2, 3).unwrap()).is_none());
    }

    #[test]
    fn depacketizes_single_stap_and_fu() {
        let mut depacketizer = H264Depacketizer::default();
        // STAP-A carrying SPS (0x67) and PPS (0x68).
        let stap = [24, 0, 2, 0x67, 1, 0, 1, 0x68];
        assert_eq!(depacketizer.push(&packet(false, 10, 90, &stap)), Ok(None));
        // IDR (type 5, NRI 3) split into FU-A start + end.
        assert_eq!(depacketizer.push(&packet(false, 11, 90, &[0x7C, 0x85, 0xAA])), Ok(None));
        let frame = depacketizer.push(&packet(true, 12, 90, &[0x7C, 0x45, 0xBB])).unwrap();
        assert_eq!(
            frame.unwrap(),
            [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 0, 0, 0, 1, 0x65, 0xAA, 0xBB]
        );
        // Single NAL frame; then a gap drops the next frame.
        let single = depacketizer.push(&packet(true, 13, 180, &[0x41, 7])).unwrap();
        assert_eq!(single.unwrap(), [0, 0, 0, 1, 0x41, 7]);
        assert_eq!(depacketizer.push(&packet(true, 15, 270, &[0x41, 8])), Err(()));
        assert_eq!(
            depacketizer.push(&packet(true, 16, 360, &[0x41, 9])).unwrap().unwrap(),
            [0, 0, 0, 1, 0x41, 9]
        );
    }
}
