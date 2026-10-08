//! Typed messages between the UI thread and the backend task.

use crate::model::{Channel, Guild, Message, User, VoiceState};

/// Sends [`UiEvent`]s to the UI thread and wakes egui's loop right after.
/// The loop only redraws on input otherwise, so background events (guild
/// lists, messages, typing) would sit in the channel until the next mouse
/// move. `egui::Context` is `Send + Sync` and its `request_repaint` is
/// wired by eframe to the native event loop.
#[derive(Clone)]
pub struct EventTx {
    tx: tokio::sync::mpsc::UnboundedSender<UiEvent>,
    ctx: egui::Context,
}

impl EventTx {
    pub fn new(tx: tokio::sync::mpsc::UnboundedSender<UiEvent>, ctx: egui::Context) -> Self {
        Self { tx, ctx }
    }

    pub fn send(&self, event: UiEvent) {
        let _ = self.tx.send(event);
        self.ctx.request_repaint();
    }
}

/// Requests from the UI thread to the backend task.
#[derive(Debug, Clone)]
pub enum Command {
    LoadGuilds,
    LoadDmChannels,
    LoadGuildChannels {
        guild_id: String,
    },
    LoadMessages {
        channel_id: String,
        before: Option<String>,
    },
    SendMessage {
        channel_id: String,
        content: String,
    },
    /// Signal the user is typing, at most once every few seconds.
    SendTyping {
        channel_id: String,
    },
    /// Join a guild voice channel: op 4 over the live socket. Re-sent with
    /// the same channel and new flags for mute/deafen toggles.
    JoinVoice {
        guild_id: String,
        channel_id: String,
        self_mute: bool,
        self_deaf: bool,
    },
    LeaveVoice {
        guild_id: String,
    },
    /// Go Live (docs/SCREENSHARE.md): op 18 CREATE_STREAM + op 22 unpause,
    /// for the voice channel we're connected to.
    StartStream {
        guild_id: String,
        channel_id: String,
        stream_key: String,
    },
    /// op 19 DELETE_STREAM.
    StopStream {
        stream_key: String,
    },
    /// Fetch a guild member (name/avatar) for a voice state that only
    /// carries a user id, as in READY.
    LoadVoiceUser {
        guild_id: String,
        user_id: String,
    },
}

/// Updates from the backend task to the UI thread.
#[derive(Debug)]
pub enum UiEvent {
    Connected,
    Ready {
        user: User,
    },
    Disconnected {
        reason: String,
        retry_in: Option<u64>,
    },
    TokenInvalid,
    GuildsLoaded {
        guilds: Vec<Guild>,
    },
    DmChannelsLoaded {
        channels: Vec<Channel>,
    },
    GuildChannelsLoaded {
        guild_id: String,
        channels: Vec<Channel>,
    },
    MessagesLoaded {
        channel_id: String,
        messages: Vec<Message>,
        older: bool,
    },
    MessageCreated {
        message: Message,
    },
    MessageUpdated {
        channel_id: String,
        message_id: String,
        content: String,
    },
    MessageDeleted {
        channel_id: String,
        message_id: String,
    },
    SendFailed {
        channel_id: String,
        error: String,
    },
    TypingStart {
        channel_id: String,
        user_id: String,
    },
    PresenceUpdate {
        user_id: String,
        status: String,
    },
    /// Voice states seeded from READY, one event per guild.
    GuildVoiceStates {
        guild_id: String,
        states: Vec<VoiceState>,
    },
    /// Any user's voice state changed (who is in which channel).
    VoiceStateUpdate {
        state: VoiceState,
    },
    /// A member lookup resolved to a user, for the voice roster.
    UserResolved {
        user: User,
    },
    /// The driver finished the voice handshake (DAVE included).
    VoiceConnected {
        guild_id: String,
        channel_id: String,
    },
    VoiceFailed {
        error: String,
    },
    VoiceLeft,
    /// A user started or stopped producing audio (speaking indicator).
    VoiceSpeaking {
        user_id: String,
        speaking: bool,
    },
    /// Discord allocated a stream server for a Go Live stream.
    StreamCreated {
        stream_key: String,
    },
    /// A stream ended server-side (`reason`: user_requested, stream_full,
    /// unauthorized, …).
    StreamDeleted {
        stream_key: String,
        reason: String,
    },
    /// An unmapped SSRC kept speaking for seconds: the voice session lost
    /// sync (DAVE re-key, reconnect) and needs a fresh handshake.
    VoiceSuspectDesync,
    Error {
        context: String,
    },
    /// QR login: a code is ready to scan.
    QrReady {
        url: String,
    },
    /// QR login: scanned, waiting for approval on the phone. The user info
    /// comes from `pending_ticket` (id:discriminator:avatar:username).
    QrScanned {
        username: String,
        user_id: String,
        avatar: Option<String>,
    },
    QrLogin {
        token: String,
    },
    /// QR login: the code expired; the UI regenerates it silently.
    QrExpired,
    QrFailed {
        reason: String,
    },
}
