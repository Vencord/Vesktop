//! Discord API data models. Only the fields the native client actually uses
//! are modeled; everything else arrives with `#[serde(default)]`.

use serde::{Deserialize, Serialize};

pub const CHANNEL_KIND_GUILD_TEXT: i64 = 0;
pub const CHANNEL_KIND_DM: i64 = 1;
pub const CHANNEL_KIND_VOICE: i64 = 2;
pub const CHANNEL_KIND_GROUP_DM: i64 = 3;
pub const CHANNEL_KIND_CATEGORY: i64 = 4;
pub const CHANNEL_KIND_ANNOUNCEMENT: i64 = 5;

/// Message types rendered as regular chat messages (0 = default, plus the
/// common "system" ones the client just shows as plain text for now).
pub const MESSAGE_KIND_DEFAULT: i64 = 0;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub discriminator: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

impl User {
    pub fn display_name(&self) -> &str {
        self.global_name.as_deref().unwrap_or(&self.username)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Guild {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub recipients: Vec<User>,
}

impl Channel {
    pub fn is_voice(&self) -> bool {
        self.kind == CHANNEL_KIND_VOICE
    }

    pub fn is_selectable(&self) -> bool {
        matches!(
            self.kind,
            CHANNEL_KIND_GUILD_TEXT | CHANNEL_KIND_ANNOUNCEMENT | CHANNEL_KIND_DM | CHANNEL_KIND_GROUP_DM
        )
    }

    pub fn display_name(&self) -> String {
        match self.kind {
            CHANNEL_KIND_DM => self
                .recipients
                .first()
                .map(|user| user.display_name().to_string())
                .unwrap_or_else(|| "Mensagem direta".to_string()),
            CHANNEL_KIND_GROUP_DM => self
                .name
                .clone()
                .unwrap_or_else(|| "Grupo".to_string()),
            _ => self.name.clone().unwrap_or_default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    #[serde(default)]
    pub channel_id: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub edited_timestamp: Option<String>,
    pub author: User,
    #[serde(rename = "type", default)]
    pub kind: i64,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub embeds: Vec<Embed>,
}

impl Message {
    pub fn is_system(&self) -> bool {
        self.kind != MESSAGE_KIND_DEFAULT
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Embed {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}
