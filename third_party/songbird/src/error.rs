//! Driver and gateway error handling.

#[cfg(feature = "serenity")]
use futures::channel::mpsc::TrySendError;
pub use serde_json::Error as JsonError;
#[cfg(feature = "serenity")]
use serenity::gateway::ShardRunnerMessage;
#[cfg(feature = "gateway")]
use std::{error::Error, fmt};
#[cfg(feature = "twilight")]
use twilight_gateway::error::ChannelError;

#[cfg(feature = "gateway")]
#[derive(Debug)]
#[non_exhaustive]
/// Error returned when a manager or call handler is
/// unable to send messages over Discord's gateway.
pub enum JoinError {
    /// Request to join was dropped, cancelled, or replaced.
    Dropped,
    /// No available gateway connection was provided to send
    /// voice state update messages.
    NoSender,
    /// Tried to leave a [`Call`] which was not found.
    ///
    /// [`Call`]: crate::Call
    NoCall,
    /// Connection details were not received from Discord in the
    /// time given in [the `Call`'s configuration].
    ///
    /// This can occur if a message is lost by the Discord client
    /// between restarts, or if Discord's gateway believes that
    /// this bot is still in the channel it attempts to join.
    ///
    /// *Users should `leave` the server on the gateway before
    /// re-attempting connection.*
    ///
    /// [the `Call`'s configuration]: crate::Config
    TimedOut,
    #[cfg(feature = "driver")]
    /// The driver failed to establish a voice connection.
    ///
    /// *Users should `leave` the server on the gateway before
    /// re-attempting connection.*
    Driver(ConnectionError),
    #[cfg(feature = "serenity")]
    /// Serenity-specific WebSocket send error.
    Serenity(Box<TrySendError<ShardRunnerMessage>>),
    #[cfg(feature = "twilight")]
    /// Twilight-specific WebSocket send error when a message fails to send over websocket.
    Twilight(ChannelError),
}

#[cfg(feature = "gateway")]
impl JoinError {
    /// Indicates whether this failure may have left (or been
    /// caused by) Discord's gateway state being in an
    /// inconsistent state.
    ///
    /// Failure to `leave` before rejoining may cause further
    /// timeouts.
    pub fn should_leave_server(&self) -> bool {
        matches!(self, JoinError::TimedOut)
    }

    #[cfg(feature = "driver")]
    /// Indicates whether this failure can be reattempted via
    /// [`Driver::connect`] with retreived connection info.
    ///
    /// Failure to `leave` before rejoining may cause further
    /// timeouts.
    ///
    /// [`Driver::connect`]: crate::driver::Driver
    pub fn should_reconnect_driver(&self) -> bool {
        matches!(self, JoinError::Driver(_))
    }
}

#[cfg(feature = "gateway")]
impl fmt::Display for JoinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "failed to join voice channel: ")?;
        match self {
            JoinError::Dropped => write!(f, "request was cancelled/dropped"),
            JoinError::NoSender => write!(f, "no gateway destination"),
            JoinError::NoCall => write!(f, "tried to leave a non-existent call"),
            JoinError::TimedOut => write!(f, "gateway response from Discord timed out"),
            #[cfg(feature = "driver")]
            JoinError::Driver(_) => write!(f, "establishing connection failed"),
            #[cfg(feature = "serenity")]
            JoinError::Serenity(e) => e.fmt(f),
            #[cfg(feature = "twilight")]
            JoinError::Twilight(e) => e.fmt(f),
        }
    }
}

#[cfg(feature = "gateway")]
impl Error for JoinError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            JoinError::Dropped => None,
            JoinError::NoSender => None,
            JoinError::NoCall => None,
            JoinError::TimedOut => None,
            #[cfg(feature = "driver")]
            JoinError::Driver(e) => Some(e),
            #[cfg(feature = "serenity")]
            JoinError::Serenity(e) => e.source(),
            #[cfg(feature = "twilight")]
            JoinError::Twilight(e) => e.source(),
        }
    }
}

#[cfg(all(feature = "serenity", feature = "gateway"))]
impl From<Box<TrySendError<ShardRunnerMessage>>> for JoinError {
    fn from(e: Box<TrySendError<ShardRunnerMessage>>) -> Self {
        JoinError::Serenity(e)
    }
}

#[cfg(all(feature = "twilight", feature = "gateway"))]
impl From<ChannelError> for JoinError {
    fn from(e: ChannelError) -> Self {
        JoinError::Twilight(e)
    }
}

#[cfg(all(feature = "driver", feature = "gateway"))]
impl From<ConnectionError> for JoinError {
    fn from(e: ConnectionError) -> Self {
        JoinError::Driver(e)
    }
}

#[cfg(feature = "gateway")]
/// Convenience type for Discord gateway error handling.
pub type JoinResult<T> = Result<T, JoinError>;

#[cfg(feature = "driver")]
pub use crate::{
    driver::{
        connection::error::{Error as ConnectionError, Result as ConnectionResult},
        SchedulerError,
    },
    tracks::{ControlError, PlayError, TrackResult},
};
