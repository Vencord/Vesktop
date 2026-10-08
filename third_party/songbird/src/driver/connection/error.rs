//! Connection errors and convenience types.

use crate::{
    driver::tasks::{error::Recipient, message::*},
    ws::Error as WsError,
};
use aes_gcm::Error as CryptoError;
use davey::errors::{
    CreateKeyPackageError as DaveyCreateKeyPackageError,
    InitError as DaveyInitError,
};
use flume::SendError;
use serde_json::Error as JsonError;
use std::{error::Error as StdError, fmt, io::Error as IoError};
use tokio::time::error::Elapsed;

/// Errors encountered while connecting to a Discord voice server over the driver.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// The driver hung up an internal signaller, either due to another connection attempt
    /// or a crash.
    AttemptDiscarded,
    /// An error occurred during [en/de]cryption of voice packets.
    Crypto(CryptoError),
    /// The symmetric key supplied by Discord had the wrong size.
    CryptoInvalidLength,
    /// Server did not return the expected crypto mode during negotiation.
    CryptoModeInvalid,
    /// Selected crypto mode was not offered by server.
    CryptoModeUnavailable,
    /// Failed to create a DAVE key package.
    #[cfg(feature = "driver")]
    DaveCreateKeyPackageError(DaveyCreateKeyPackageError),
    /// An error occured during initialization of the DAVE session.
    #[cfg(feature = "driver")]
    DaveInitializationError(DaveyInitError),
    /// An indicator that an endpoint URL was invalid.
    EndpointUrl,
    /// Discord failed to correctly respond to IP discovery.
    IllegalDiscoveryResponse,
    /// Could not parse Discord's view of our IP.
    IllegalIp,
    /// Miscellaneous I/O error.
    Io(IoError),
    /// JSON (de)serialization error.
    Json(JsonError),
    /// Failed to message other background tasks after connection establishment.
    InterconnectFailure(Recipient),
    /// Error communicating with gateway server over WebSocket.
    Ws(WsError),
    /// Connection attempt timed out.
    TimedOut,
}

impl From<CryptoError> for Error {
    fn from(e: CryptoError) -> Self {
        Error::Crypto(e)
    }
}

impl From<IoError> for Error {
    fn from(e: IoError) -> Error {
        Error::Io(e)
    }
}

impl From<JsonError> for Error {
    fn from(e: JsonError) -> Error {
        Error::Json(e)
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

impl From<WsError> for Error {
    fn from(e: WsError) -> Error {
        Error::Ws(e)
    }
}

impl From<Elapsed> for Error {
    fn from(_e: Elapsed) -> Error {
        Error::TimedOut
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "failed to connect to Discord RTP server: ")?;
        match self {
            Self::AttemptDiscarded => write!(f, "connection attempt was aborted/discarded"),
            Self::Crypto(e) => e.fmt(f),
            Self::CryptoInvalidLength => write!(f, "server supplied key of wrong length"),
            Self::CryptoModeInvalid => write!(f, "server changed negotiated encryption mode"),
            Self::CryptoModeUnavailable => write!(f, "server did not offer chosen encryption mode"),
            Self::DaveCreateKeyPackageError(e) => e.fmt(f),
            Self::DaveInitializationError(e) => e.fmt(f),
            Self::EndpointUrl => write!(f, "endpoint URL received from gateway was invalid"),
            Self::IllegalDiscoveryResponse => {
                write!(f, "IP discovery/NAT punching response was invalid")
            },
            Self::IllegalIp => write!(f, "IP discovery/NAT punching response had bad IP value"),
            Self::Io(e) => e.fmt(f),
            Self::Json(e) => e.fmt(f),
            Self::InterconnectFailure(e) => write!(f, "failed to contact other task ({e:?})"),
            Self::Ws(e) => write!(f, "websocket issue ({e:?})."),
            Self::TimedOut => write!(f, "connection attempt timed out"),
        }
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Error::AttemptDiscarded
            | Error::Crypto(_)
            | Error::CryptoInvalidLength
            | Error::CryptoModeInvalid
            | Error::CryptoModeUnavailable
            | Error::DaveCreateKeyPackageError(_)
            | Error::DaveInitializationError(_)
            | Error::EndpointUrl
            | Error::IllegalDiscoveryResponse
            | Error::IllegalIp
            | Error::InterconnectFailure(_)
            | Error::Ws(_)
            | Error::TimedOut => None,
            Error::Io(e) => e.source(),
            Error::Json(e) => e.source(),
        }
    }
}

/// Convenience type for Discord voice/driver connection error handling.
pub type Result<T> = std::result::Result<T, Error>;
