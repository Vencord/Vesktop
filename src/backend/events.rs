//! Typed messages between the UI thread and the backend task.

use crate::model::{Channel, Guild, Message, User};

/// Requests from the UI thread to the backend task.
#[derive(Debug, Clone)]
pub enum Command {
    LoadGuilds,
    LoadDmChannels,
    LoadGuildChannels { guild_id: String },
    LoadMessages { channel_id: String, before: Option<String> },
    SendMessage { channel_id: String, content: String },
}

/// Updates from the backend task to the UI thread.
#[derive(Debug)]
pub enum UiEvent {
    Connected,
    Ready { user: User },
    Disconnected { reason: String },
    TokenInvalid,
    GuildsLoaded { guilds: Vec<Guild> },
    DmChannelsLoaded { channels: Vec<Channel> },
    GuildChannelsLoaded { guild_id: String, channels: Vec<Channel> },
    MessagesLoaded { channel_id: String, messages: Vec<Message>, older: bool },
    MessageCreated { message: Message },
    MessageUpdated { channel_id: String, message_id: String, content: String },
    MessageDeleted { channel_id: String, message_id: String },
    SendFailed { channel_id: String, error: String },
    Error { context: String },
}
