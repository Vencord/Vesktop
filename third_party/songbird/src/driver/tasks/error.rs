use super::message::*;
use crate::ws::Error as WsError;
use aes_gcm::Error as CryptoError;
use davey::errors::EncryptError as DaveyEncryptError;
use flume::SendError;
use opus2::Error as OpusError;
use std::io::{Error as IoError, ErrorKind as IoErrorKind};

#[derive(Debug)]
pub enum Recipient {
    AuxNetwork,
    Event,
    Mixer,
    #[cfg(feature = "receive")]
    UdpRx,
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    Crypto(CryptoError),
    DaveEncrypt,
    #[cfg(any(feature = "receive", test))]
    /// Received an illegal voice packet on the voice UDP socket.
    IllegalVoicePacket,
    InterconnectFailure(Recipient),
    Io(IoError),
    Other,
}

impl Error {
    pub(crate) fn should_trigger_connect(&self) -> bool {
        match self {
            Error::InterconnectFailure(Recipient::AuxNetwork) => true,
            #[cfg(feature = "receive")]
            Error::InterconnectFailure(Recipient::UdpRx) => true,
            _ => false,
        }
    }

    pub(crate) fn should_trigger_interconnect_rebuild(&self) -> bool {
        matches!(self, Error::InterconnectFailure(Recipient::Event))
    }

    // This prevents a `WouldBlock` from triggering a full reconnect,
    // instead simply dropping the packet.
    pub(crate) fn disarm_would_block(self) -> Result<()> {
        match self {
            Self::Io(i) if i.kind() == IoErrorKind::WouldBlock => Ok(()),
            e => Err(e),
        }
    }
}

impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::Crypto(e)
    }
}

impl From<DaveyEncryptError> for Error {
    fn from(_e: DaveyEncryptError) -> Self {
        Self::DaveEncrypt
    }
}

impl From<IoError> for Error {
    fn from(e: IoError) -> Error {
        Error::Io(e)
    }
}

impl From<OpusError> for Error {
    fn from(_: OpusError) -> Error {
        Error::Other
    }
}

impl From<SendError<WsMessage>> for Error {
    fn from(_e: SendError<WsMessage>) -> Error {
        Error::InterconnectFailure(Recipient::AuxNetwork)
    }
}

impl From<SendError<EventMessage>> for Error {
    fn from(_e: SendError<EventMessage>) -> Error {
        Error::InterconnectFailure(Recipient::Event)
    }
}

impl From<SendError<MixerMessage>> for Error {
    fn from(_e: SendError<MixerMessage>) -> Error {
        Error::InterconnectFailure(Recipient::Mixer)
    }
}

#[cfg(feature = "receive")]
impl From<SendError<UdpRxMessage>> for Error {
    fn from(_e: SendError<UdpRxMessage>) -> Error {
        Error::InterconnectFailure(Recipient::UdpRx)
    }
}

impl From<WsError> for Error {
    fn from(_: WsError) -> Error {
        Error::Other
    }
}

#[derive(Debug)]
#[non_exhaustive]
pub enum DaveReinitError {
    Init,
    Reinit,
    Reset,
    CreateKeyPackage,
    Ws(WsError),
}

impl From<davey::errors::InitError> for DaveReinitError {
    fn from(_e: davey::errors::InitError) -> Self {
        Self::Init
    }
}

impl From<davey::errors::ReinitError> for DaveReinitError {
    fn from(_e: davey::errors::ReinitError) -> Self {
        Self::Reinit
    }
}

impl From<davey::errors::ResetError> for DaveReinitError {
    fn from(_e: davey::errors::ResetError) -> Self {
        Self::Reset
    }
}

impl From<davey::errors::CreateKeyPackageError> for DaveReinitError {
    fn from(_e: davey::errors::CreateKeyPackageError) -> Self {
        Self::CreateKeyPackage
    }
}

impl From<WsError> for DaveReinitError {
    fn from(e: WsError) -> Self {
        Self::Ws(e)
    }
}
