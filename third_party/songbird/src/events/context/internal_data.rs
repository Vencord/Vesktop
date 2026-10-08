use super::context_data::*;
use crate::ConnectionInfo;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct InternalConnect {
    pub info: ConnectionInfo,
    pub ssrc: u32,
}

#[derive(Debug)]
pub struct InternalDisconnect {
    pub kind: DisconnectKind,
    pub reason: Option<DisconnectReason>,
    pub info: ConnectionInfo,
}

impl<'a> From<&'a InternalConnect> for ConnectData<'a> {
    fn from(val: &'a InternalConnect) -> Self {
        Self {
            channel_id: val.info.channel_id,
            guild_id: val.info.guild_id,
            session_id: &val.info.session_id,
            server: &val.info.endpoint,
            ssrc: val.ssrc,
        }
    }
}

impl<'a> From<&'a InternalDisconnect> for DisconnectData<'a> {
    fn from(val: &'a InternalDisconnect) -> Self {
        Self {
            kind: val.kind,
            reason: val.reason,
            channel_id: val.info.channel_id,
            guild_id: val.info.guild_id,
            session_id: &val.info.session_id,
        }
    }
}

#[cfg(feature = "receive")]
mod receive {
    use super::*;
    use bytes::Bytes;

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct InternalRtpPacket {
        pub packet: Bytes,
        pub payload_offset: usize,
        pub payload_end_pad: usize,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct InternalRtcpPacket {
        pub packet: Bytes,
        pub payload_offset: usize,
        pub payload_end_pad: usize,
    }

    impl<'a> From<&'a InternalRtpPacket> for RtpData {
        fn from(val: &'a InternalRtpPacket) -> Self {
            Self {
                packet: val.packet.clone(),
                payload_offset: val.payload_offset,
                payload_end_pad: val.payload_end_pad,
            }
        }
    }

    impl<'a> From<&'a InternalRtcpPacket> for RtcpData {
        fn from(val: &'a InternalRtcpPacket) -> Self {
            Self {
                packet: val.packet.clone(),
                payload_offset: val.payload_offset,
                payload_end_pad: val.payload_end_pad,
            }
        }
    }
}

#[cfg(feature = "receive")]
pub use receive::*;
