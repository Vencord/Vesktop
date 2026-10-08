pub mod data;
pub(crate) mod internal_data;

use super::*;
use crate::{
    model::payload::{ClientDisconnect, Speaking},
    tracks::{TrackHandle, TrackState},
};
pub use data as context_data;
use data::*;
use internal_data::*;

/// Information about which tracks or data fired an event.
///
/// [`Track`] events may be local or global, and have no tracks
/// if fired on the global context via [`Driver::add_global_event`].
///
/// [`Track`]: crate::tracks::Track
/// [`Driver::add_global_event`]: crate::driver::Driver::add_global_event
#[derive(Debug)]
#[non_exhaustive]
pub enum EventContext<'a> {
    /// Track event context, passed to events created via [`TrackHandle::add_event`],
    /// [`EventStore::add_event`], or relevant global events.
    ///
    /// [`EventStore::add_event`]: EventStore::add_event
    /// [`TrackHandle::add_event`]: TrackHandle::add_event
    Track(&'a [(&'a TrackState, &'a TrackHandle)]),

    /// Speaking state update, typically describing how another voice
    /// user is transmitting audio data. Clients must send at least one such
    /// packet to allow SSRC/UserID matching.
    SpeakingStateUpdate(Speaking),

    #[cfg(feature = "receive")]
    /// Reordered and decoded audio packets, received every 20ms.
    VoiceTick(VoiceTick),

    #[cfg(feature = "receive")]
    /// Opus audio packet, received from another stream.
    RtpPacket(RtpData),

    #[cfg(feature = "receive")]
    /// Telemetry/statistics packet, received from another stream.
    RtcpPacket(RtcpData),

    /// Fired whenever a client disconnects.
    ClientDisconnect(ClientDisconnect),

    /// Fires when this driver successfully connects to a voice channel.
    DriverConnect(ConnectData<'a>),

    /// Fires when this driver successfully reconnects after a network error.
    DriverReconnect(ConnectData<'a>),

    /// Fires when this driver fails to connect to, or drops from, a voice channel.
    DriverDisconnect(DisconnectData<'a>),
}

#[derive(Debug)]
pub enum CoreContext {
    SpeakingStateUpdate(Speaking),
    #[cfg(feature = "receive")]
    VoiceTick(VoiceTick),
    #[cfg(feature = "receive")]
    RtpPacket(InternalRtpPacket),
    #[cfg(feature = "receive")]
    RtcpPacket(InternalRtcpPacket),
    ClientDisconnect(ClientDisconnect),
    DriverConnect(InternalConnect),
    DriverReconnect(InternalConnect),
    DriverDisconnect(InternalDisconnect),
}

impl<'a> CoreContext {
    pub(crate) fn to_user_context(&'a self) -> EventContext<'a> {
        match self {
            Self::SpeakingStateUpdate(evt) => EventContext::SpeakingStateUpdate(*evt),
            #[cfg(feature = "receive")]
            Self::VoiceTick(evt) => EventContext::VoiceTick(evt.clone()),
            #[cfg(feature = "receive")]
            Self::RtpPacket(evt) => EventContext::RtpPacket(RtpData::from(evt)),
            #[cfg(feature = "receive")]
            Self::RtcpPacket(evt) => EventContext::RtcpPacket(RtcpData::from(evt)),
            Self::ClientDisconnect(evt) => EventContext::ClientDisconnect(*evt),
            Self::DriverConnect(evt) => EventContext::DriverConnect(ConnectData::from(evt)),
            Self::DriverReconnect(evt) => EventContext::DriverReconnect(ConnectData::from(evt)),
            Self::DriverDisconnect(evt) =>
                EventContext::DriverDisconnect(DisconnectData::from(evt)),
        }
    }
}

impl EventContext<'_> {
    /// Retreive the event class for an event (i.e., when matching)
    /// an event against the registered listeners.
    #[must_use]
    pub fn to_core_event(&self) -> Option<CoreEvent> {
        match self {
            Self::SpeakingStateUpdate(_) => Some(CoreEvent::SpeakingStateUpdate),
            #[cfg(feature = "receive")]
            Self::VoiceTick(_) => Some(CoreEvent::VoiceTick),
            #[cfg(feature = "receive")]
            Self::RtpPacket(_) => Some(CoreEvent::RtpPacket),
            #[cfg(feature = "receive")]
            Self::RtcpPacket(_) => Some(CoreEvent::RtcpPacket),
            Self::ClientDisconnect(_) => Some(CoreEvent::ClientDisconnect),
            Self::DriverConnect(_) => Some(CoreEvent::DriverConnect),
            Self::DriverReconnect(_) => Some(CoreEvent::DriverReconnect),
            Self::DriverDisconnect(_) => Some(CoreEvent::DriverDisconnect),
            _ => None,
        }
    }
}
