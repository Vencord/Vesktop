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

    /// Decrypts an RTCP packet (8 clear header bytes) and returns it whole,
    /// header plus plaintext body. `None` for RTP or forged packets.
    pub fn open_rtcp(&self, packet: &[u8]) -> Option<Vec<u8>> {
        if packet.len() < 8 + TAG_LEN + NONCE_LEN || !(192..=223).contains(&packet[1]) {
            return None;
        }
        let (aad, rest) = packet.split_at(8);
        let (sealed, nonce) = rest.split_at(rest.len() - NONCE_LEN);
        let (body, tag) = sealed.split_at(sealed.len() - TAG_LEN);
        let mut full_nonce = Nonce::default();
        full_nonce[..NONCE_LEN].copy_from_slice(nonce);
        let mut plain = body.to_vec();
        self.0
            .decrypt_in_place_detached(&full_nonce, aad, &mut plain, Tag::from_slice(tag))
            .ok()?;
        let mut whole = aad.to_vec();
        whole.extend_from_slice(&plain);
        Some(whole)
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

/// RTCP Sender Report for `ssrc` (RFC 3550): wall clock (NTP) against
/// the RTP timestamp, plus packet and payload-octet counts. Discord's SFU
/// relies on these for its viewers, as Discord-video-stream sends them.
pub fn sender_report(
    cipher: &Cipher,
    ssrc: u32,
    timestamp: u32,
    packets: u32,
    octets: u32,
    counter: u32,
) -> Option<Vec<u8>> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    // NTP counts from 1900; the fraction is 32-bit fixed point.
    let seconds = (now.as_secs() + 2_208_988_800) as u32;
    let fraction = ((u64::from(now.subsec_nanos()) << 32) / 1_000_000_000) as u32;
    let mut packet = vec![0x80, 200, 0, 6];
    packet.extend_from_slice(&ssrc.to_be_bytes());
    for word in [seconds, fraction, timestamp, packets, octets] {
        packet.extend_from_slice(&word.to_be_bytes());
    }
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

/// Whether a decrypted RTCP packet asks for a keyframe: PLI (206/1) or
/// FIR (206/4), anywhere in a compound packet.
pub fn wants_keyframe(rtcp: &[u8]) -> bool {
    let mut rest = rtcp;
    while rest.len() >= 4 {
        let (fmt, kind) = (rest[0] & 0x1F, rest[1]);
        if kind == 206 && (fmt == 1 || fmt == 4) {
            return true;
        }
        let len = (usize::from(u16::from_be_bytes([rest[2], rest[3]])) + 1) * 4;
        rest = rest.get(len..).unwrap_or_default();
    }
    false
}

const START_CODE: [u8; 4] = [0, 0, 0, 1];

/// Largest RTP payload we send (discord-native-voice's MTU).
const MTU: usize = 1200;
/// Bytes of an outgoing video packet left in the clear: fixed header plus
/// the extension preamble.
pub const VIDEO_CLEAR: usize = 16;

/// NAL units of an Annex-B stream, start codes stripped.
pub fn split_annex_b(stream: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= stream.len() {
        if stream[i] == 0 && stream[i + 1] == 0 && stream[i + 2] == 1 {
            starts.push(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(n, &start)| {
            let end = starts.get(n + 1).map_or(stream.len(), |&next| {
                // A 4-byte start code's leading zero belongs to it.
                if next >= 4 && stream[next - 4] == 0 { next - 4 } else { next - 3 }
            });
            &stream[start..end.max(start)]
        })
        .filter(|nal| !nal.is_empty())
        .collect()
}

/// Splits Annex-B access units into RTP packets (single NAL or FU-A), each
/// with the one-byte extensions discord-native-voice sends on video
/// (`src/python/transport.rs`): with only playout-delay and content-type
/// the SFU took the packets but forwarded nothing — it needs at least the
/// rid naming the announced layer and transport-cc. Packets come out in
/// the clear; seal them with `VIDEO_CLEAR`.
pub struct H264Packetizer {
    pub ssrc: u32,
    pub payload_type: u8,
    pub sequence: u16,
    /// transport-cc counter, one per packet.
    pub transport_sequence: u16,
    /// The simulcast layer announced in op 12.
    pub rid: &'static str,
}

/// One-byte header extension element: id/length nibble, then the data.
fn push_extension(out: &mut Vec<u8>, id: u8, data: &[u8]) {
    out.push((id << 4) | (data.len() as u8 - 1));
    out.extend_from_slice(data);
}

/// abs-send-time: 6.18 fixed-point seconds, 24 bits.
fn abs_send_time() -> [u8; 3] {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64());
    let value = ((seconds % 64.0) * 262_144.0) as u32;
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

impl H264Packetizer {
    pub fn packetize(&mut self, frame: &[u8], timestamp: u32) -> Vec<Vec<u8>> {
        let nals = split_annex_b(frame);
        let mut packets = Vec::new();
        for (index, nal) in nals.iter().enumerate() {
            let last_nal = index + 1 == nals.len();
            if nal.len() <= MTU {
                packets.push(self.packet(nal, &[], last_nal, timestamp));
                continue;
            }
            let (header, data) = (nal[0], &nal[1..]);
            let chunks: Vec<&[u8]> = data.chunks(MTU - 2).collect();
            for (n, chunk) in chunks.iter().enumerate() {
                let (first, last) = (n == 0, n + 1 == chunks.len());
                let fu = [
                    (header & 0x60) | 28,
                    if first { 0x80 } else { 0 } | if last { 0x40 } else { 0 } | (header & 0x1F),
                ];
                packets.push(self.packet(chunk, &fu, last_nal && last, timestamp));
            }
        }
        packets
    }

    fn packet(&mut self, payload: &[u8], prefix: &[u8], marker: bool, timestamp: u32) -> Vec<u8> {
        let mut packet = Vec::with_capacity(VIDEO_CLEAR + 8 + prefix.len() + payload.len() + 20);
        packet.push(0x90); // V=2, X=1
        packet.push(if marker { 0x80 } else { 0 } | self.payload_type);
        packet.extend_from_slice(&self.sequence.to_be_bytes());
        packet.extend_from_slice(&timestamp.to_be_bytes());
        packet.extend_from_slice(&self.ssrc.to_be_bytes());
        self.transport_sequence = self.transport_sequence.wrapping_add(1);
        let mut extensions = Vec::with_capacity(48);
        push_extension(&mut extensions, 2, &[0, 0, 0]); // toffset
        push_extension(&mut extensions, 3, &abs_send_time());
        push_extension(&mut extensions, 4, &[0]); // video orientation
        push_extension(&mut extensions, 5, &self.transport_sequence.to_be_bytes());
        push_extension(&mut extensions, 6, &[0, 0, 0]); // playout delay
        push_extension(&mut extensions, 7, &[1]); // content type: screen
        push_extension(&mut extensions, 8, &[0; 13]); // video timing
        push_extension(&mut extensions, 10, b"screen"); // media stream type
        push_extension(&mut extensions, 11, self.rid.as_bytes());
        extensions.resize(extensions.len().next_multiple_of(4), 0);
        // Preamble (clear), then the elements (encrypted with the payload).
        packet.extend_from_slice(&[0xBE, 0xDE]);
        packet.extend_from_slice(&((extensions.len() / 4) as u16).to_be_bytes());
        packet.extend_from_slice(&extensions);
        packet.extend_from_slice(prefix);
        packet.extend_from_slice(payload);
        self.sequence = self.sequence.wrapping_add(1);
        packet
    }
}

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
    fn packetized_frames_survive_the_round_trip() {
        let cipher = Cipher::new(&[3u8; 32]).unwrap();
        let mut packetizer = H264Packetizer {
            ssrc: 91,
            payload_type: 105,
            sequence: 65_535,
            transport_sequence: 0,
            rid: "100",
        };
        // SPS + an IDR big enough for three FU-A packets.
        let mut frame = vec![0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x65];
        frame.extend((0..3000).map(|i| (i % 251) as u8 + 1));
        let packets = packetizer.packetize(&frame, 9000);
        assert_eq!(packets.len(), 4);
        let mut depacketizer = H264Depacketizer::default();
        let mut out = None;
        for (counter, mut packet) in packets.into_iter().enumerate() {
            cipher.seal(&mut packet, VIDEO_CLEAR, counter as u32).unwrap();
            let rtp = cipher.open_rtp(&packet).unwrap();
            assert_eq!((rtp.ssrc, rtp.timestamp), (91, 9000));
            out = depacketizer.push(&rtp).unwrap();
        }
        // The 3-byte start code comes back as a 4-byte one.
        let mut expected = frame.clone();
        expected.insert(7, 0);
        assert_eq!(out.unwrap(), expected);
        assert_eq!(packetizer.sequence, 3);

        let pli = cipher.open_rtcp(&pli(&cipher, 1, 91, 7).unwrap()).unwrap();
        assert!(wants_keyframe(&pli));
        assert!(!wants_keyframe(&cipher.open_rtcp(&receiver_report(&cipher, 1, 8).unwrap()).unwrap()));
        let sr = cipher.open_rtcp(&sender_report(&cipher, 91, 9000, 4, 3000, 9).unwrap()).unwrap();
        assert_eq!((sr.len(), sr[1], &sr[4..8], &sr[16..20]), (28, 200, &91u32.to_be_bytes()[..], &9000u32.to_be_bytes()[..]));
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
