/// Voice core events occur on receipt of
/// voice packets and telemetry.
///
/// Core events persist while the `action` in [`EventData`]
/// returns `None`.
///
/// ## Events from other users
/// Songbird can observe when a user *speaks for the first time* ([`SpeakingStateUpdate`]),
/// when a client leaves the session ([`ClientDisconnect`]).
///
/// When the `"receive"` feature is enabled, songbird can also handle voice packets
#[cfg_attr(feature = "receive", doc = "([`RtpPacket`](Self::RtpPacket)),")]
#[cfg_attr(not(feature = "receive"), doc = "(`RtpPacket`),")]
/// decode and track speaking users
#[cfg_attr(feature = "receive", doc = "([`VoiceTick`](Self::VoiceTick)),")]
#[cfg_attr(not(feature = "receive"), doc = "(`VoiceTick`),")]
/// and handle telemetry data
#[cfg_attr(feature = "receive", doc = "([`RtcpPacket`](Self::RtcpPacket)).")]
#[cfg_attr(not(feature = "receive"), doc = "(`RtcpPacket`).")]
/// The format of voice packets is described by
#[cfg_attr(
    feature = "receive",
    doc = "[`VoiceData`](super::context::data::VoiceData)."
)]
#[cfg_attr(not(feature = "receive"), doc = "`VoiceData`.")]
///
/// To detect when a user connects, you must correlate gateway (e.g., `VoiceStateUpdate`) events
/// from the main part of your bot.
///
/// To obtain a user's SSRC, you must use [`SpeakingStateUpdate`] events.
///
/// [`EventData`]: super::EventData
/// [`SpeakingStateUpdate`]: Self::SpeakingStateUpdate
/// [`ClientDisconnect`]: Self::ClientDisconnect
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, enum_map::Enum)]
#[non_exhaustive]
pub enum CoreEvent {
    /// Speaking state update from the WS gateway, typically describing how another voice
    /// user is transmitting audio data. Clients must send at least one such
    /// packet to allow SSRC/UserID matching.
    ///
    /// Fired on receipt of a speaking state update from another host.
    ///
    /// Note: this will fire when a user starts speaking for the first time,
    /// or changes their capabilities.
    SpeakingStateUpdate,

    #[cfg(feature = "receive")]
    /// Fires every 20ms, containing the scheduled voice packet and decoded audio
    /// data for each live user.
    VoiceTick,

    #[cfg(feature = "receive")]
    /// Fires on receipt of a voice packet from another stream in the voice call.
    ///
    /// As RTP packets do not map to Discord's notion of users, SSRCs must be mapped
    /// back using the user IDs seen through client connection, disconnection,
    /// or speaking state update.
    RtpPacket,

    #[cfg(feature = "receive")]
    /// Fires on receipt of an RTCP packet, containing various call stats
    /// such as latency reports.
    RtcpPacket,

    /// Fires whenever a user disconnects from the same stream as the bot.
    ClientDisconnect,

    /// Fires when this driver successfully connects to a voice channel.
    DriverConnect,

    /// Fires when this driver successfully reconnects after a network error.
    DriverReconnect,

    /// Fires when this driver fails to connect to, or drops from, a voice channel.
    DriverDisconnect,
}
