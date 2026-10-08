use discortp::rtp::RtpPacket;

use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
/// Opus audio packet, received from another stream
///
/// `payload_offset` contains the true payload location within the raw packet's `payload()`,
/// if extensions or raw packet data are required.
pub struct RtpData {
    /// Raw RTP packet data.
    ///
    /// Includes the SSRC (i.e., sender) of this packet.
    pub packet: Bytes,
    /// Byte index into the packet body (after headers) for where the payload begins.
    pub payload_offset: usize,
    /// Number of bytes at the end of the packet to discard.
    pub payload_end_pad: usize,
}

impl RtpData {
    /// Create a zero-copy view of the inner RTP packet.
    ///
    /// This allows easy access to packet header fields, taking them from the underlying
    /// `Bytes` as needed while handling endianness etc.
    pub fn rtp(&'_ self) -> RtpPacket<'_> {
        RtpPacket::new(&self.packet)
            .expect("FATAL: leaked illegally small RTP packet from UDP Rx task.")
    }
}
