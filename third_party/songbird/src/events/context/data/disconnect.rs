use crate::{
    error::ConnectionError,
    id::*,
    model::{CloseCode as VoiceCloseCode, FromPrimitive},
    ws::Error as WsError,
};
#[cfg(feature = "tungstenite")]
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

/// Voice connection details gathered at termination or failure.
///
/// In the event of a failure, this event data is gathered after
/// a reconnection strategy has exhausted all of its attempts.
#[derive(Debug)]
#[non_exhaustive]
pub struct DisconnectData<'a> {
    /// The location that a voice connection was terminated.
    pub kind: DisconnectKind,
    /// The cause of any connection failure.
    ///
    /// If `None`, then this disconnect was requested by the user in some way
    /// (i.e., leaving or changing voice channels).
    pub reason: Option<DisconnectReason>,
    /// ID of the voice channel being joined.
    ///
    /// This can be used to reconnect/renew a voice session via the gateway.
    pub channel_id: ChannelId,
    /// ID of the target voice channel's parent guild.
    pub guild_id: GuildId,
    /// Unique string describing this session for validation/authentication purposes.
    pub session_id: &'a str,
}

/// The location that a voice connection was terminated.
#[derive(Copy, Clone, Debug, Eq, Hash, PartialEq)]
#[non_exhaustive]
pub enum DisconnectKind {
    /// The voice driver failed to connect to the server.
    ///
    /// This requires explicit handling at the gateway level
    /// to either reconnect or fully disconnect.
    Connect,
    /// The voice driver failed to reconnect to the server.
    ///
    /// This requires explicit handling at the gateway level
    /// to either reconnect or fully disconnect.
    Reconnect,
    /// The voice connection was terminated mid-session by either
    /// the user or Discord.
    ///
    /// If `reason == None`, then this disconnection is either
    /// a full disconnect or a user-requested channel change.
    /// Otherwise, this is likely a session expiry (requiring user
    /// handling to fully disconnect/reconnect).
    Runtime,
}

/// The reason that a voice connection failed.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum DisconnectReason {
    /// This (re)connection attempt was dropped due to another request.
    AttemptDiscarded,
    /// Songbird had an internal error.
    ///
    /// This should never happen; if this is ever seen, raise an issue with logs.
    Internal,
    /// A host-specific I/O error caused the fault; this is likely transient, and
    /// should be retried some time later.
    Io,
    /// Songbird and Discord disagreed on the protocol used to establish a
    /// voice connection.
    ///
    /// This should never happen; if this is ever seen, raise an issue with logs.
    ProtocolViolation,
    /// A voice connection was not established in the specified time.
    TimedOut,
    /// The call was manually disconnected by a user command, e.g. [`Driver::leave`].
    ///
    /// [`Driver::leave`]: crate::driver::Driver::leave
    Requested,
    /// The Websocket connection was closed by Discord.
    ///
    /// This typically indicates that the voice session has expired,
    /// and a new one needs to be requested via the gateway.
    WsClosed(Option<VoiceCloseCode>),
}

impl From<&ConnectionError> for DisconnectReason {
    fn from(e: &ConnectionError) -> Self {
        match e {
            ConnectionError::AttemptDiscarded => Self::AttemptDiscarded,
            ConnectionError::CryptoInvalidLength
            | ConnectionError::CryptoModeInvalid
            | ConnectionError::CryptoModeUnavailable
            | ConnectionError::DaveCreateKeyPackageError(_)
            | ConnectionError::DaveInitializationError(_)
            | ConnectionError::EndpointUrl
            | ConnectionError::IllegalDiscoveryResponse
            | ConnectionError::IllegalIp
            | ConnectionError::Json(_) => Self::ProtocolViolation,
            ConnectionError::Io(_) => Self::Io,
            ConnectionError::Crypto(_) | ConnectionError::InterconnectFailure(_) => Self::Internal,
            ConnectionError::Ws(ws) => ws.into(),
            ConnectionError::TimedOut => Self::TimedOut,
        }
    }
}

impl From<&WsError> for DisconnectReason {
    fn from(e: &WsError) -> Self {
        Self::WsClosed(match e {
            #[cfg(feature = "tungstenite")]
            WsError::WsClosed(Some(frame)) => match frame.code {
                CloseCode::Library(l) => VoiceCloseCode::from_u16(l),
                _ => None,
            },
            #[cfg(feature = "tws")]
            WsError::WsClosed(Some(code)) => match (*code).into() {
                code @ 4000..=4999_u16 => VoiceCloseCode::from_u16(code),
                _ => None,
            },
            _ => None,
        })
    }
}
