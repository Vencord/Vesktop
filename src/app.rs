//! Application state and root UI orchestration: panels, event routing,
//! selection bookkeeping and settings persistence.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use egui::Context;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;

use crate::backend::voice::VoiceCommand;
use crate::backend::{self, Command, UiEvent};
use crate::image_cache::ImageCache;
use crate::model::{Channel, Guild, Message, User, VoiceState};
use crate::settings::{Settings, Theme};
use crate::theme;
use crate::ui;

/// Commands the experimental tray can hand to the app.
pub enum TrayCommand {
    Quit,
}

/// What the connection indicator should show right now.
#[derive(Debug, Clone)]
pub(crate) enum ConnState {
    Connecting,
    Connected,
    Disconnected(String, Option<u64>),
    LoginError(String),
}

/// Where the login screen's QR-code session stands.
#[derive(Debug, Clone)]
pub(crate) enum QrState {
    Idle,
    Loading,
    Code(String),
    Scanned {
        username: String,
        user_id: String,
        avatar: Option<String>,
    },
    Failed(String),
}

/// How a channel id maps back to its owner, for unread routing and titles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChannelRef {
    Guild(String),
    Dm,
}

/// The single voice connection a user account can hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VoiceConn {
    Disconnected,
    Connecting {
        guild_id: String,
        channel_id: String,
    },
    Connected {
        guild_id: String,
        channel_id: String,
    },
    Failed {
        error: String,
    },
}

pub struct VesktopApp {
    pub(crate) settings: Settings,
    pub(crate) handle: tokio::runtime::Handle,
    event_tx: backend::EventTx,
    pub(crate) event_rx: UnboundedReceiver<UiEvent>,
    pub(crate) cmd_tx: UnboundedSender<Command>,
    backend: Option<JoinHandle<()>>,
    qr_task: Option<JoinHandle<()>>,
    /// Voice driver task; commanded through `voice_cmd_tx` (join/leave).
    voice_task: Option<JoinHandle<()>>,
    voice_cmd_tx: UnboundedSender<backend::voice::VoiceCommand>,
    pub(crate) qr: QrState,
    #[cfg_attr(not(feature = "tray"), allow(dead_code))]
    tray_tx: std::sync::mpsc::Sender<TrayCommand>,
    pub(crate) tray_rx: std::sync::mpsc::Receiver<TrayCommand>,

    pub(crate) conn: ConnState,
    pub(crate) me: Option<User>,
    pub(crate) guilds: Vec<Guild>,
    pub(crate) dm_channels: Vec<Channel>,
    pub(crate) guild_channels: HashMap<String, Vec<Channel>>,
    pub(crate) channel_index: HashMap<String, ChannelRef>,
    pub(crate) messages: HashMap<String, Vec<Message>>,
    pub(crate) has_more: HashMap<String, bool>,
    pub(crate) loading_channels: HashSet<String>,
    pub(crate) loading_guilds: HashSet<String>,
    pub(crate) unread: HashMap<String, u64>,
    pub(crate) mentions: HashMap<String, u64>,
    /// First unread message per channel, for the red "NOVAS" divider.
    pub(crate) first_unread: HashMap<String, String>,
    /// Last message the user has seen (timeline was at the bottom).
    pub(crate) last_seen: HashMap<String, String>,
    /// Per-channel, per-user instant of the last TYPING_START.
    pub(crate) typing: HashMap<String, HashMap<String, std::time::Instant>>,
    /// Latest presence status per user id ("online", "idle", "dnd", …).
    pub(crate) presence: HashMap<String, String>,
    /// When the last Disconnected event landed, to count the retry down.
    pub(crate) disconnected_at: Option<std::time::Instant>,
    /// Who is in which voice channel: guild → user → state.
    pub(crate) voice_states: HashMap<String, HashMap<String, VoiceState>>,
    /// The user's own voice connection, for the sidebar panel.
    pub(crate) voice: VoiceConn,
    /// Rejoin timestamps from DAVE desync self-heals (songbird #310):
    /// bounded so a broken session can't loop forever.
    desync_rejoins: Vec<std::time::Instant>,
    /// Users currently producing audio, for the green indicators.
    pub(crate) speaking: HashSet<String>,
    /// Own mic/headphone flags; op 4 sends them, the panel shows them.
    pub(crate) voice_muted: bool,
    pub(crate) voice_deaf: bool,
    /// Voice-state user ids we already asked the API for.
    voice_users_pending: HashSet<String>,
    pub(crate) selected_guild: Option<String>,
    pub(crate) selected_channel: Option<String>,
    pub(crate) user_cache: HashMap<String, User>,
    pub(crate) images: ImageCache,
    /// Larger cache for inline image attachments.
    pub(crate) images_large: ImageCache,

    pub(crate) compose: String,
    pub(crate) compose_error: Option<String>,
    /// Whether the compose box changed since last frame (typing signal).
    pub(crate) last_compose: String,
    pub(crate) last_typing_sent: Option<std::time::Instant>,
    /// Set by "Ir para o presente", consumed inside the timeline's scroll.
    pub(crate) jump_to_present: bool,
    pub(crate) settings_open: bool,
    pub(crate) login_token: String,
    /// "Encontre ou comece uma conversa" filter for the DM list.
    pub(crate) dm_search: String,
    pub(crate) applied_theme: Option<Theme>,
}

impl VesktopApp {
    pub fn new(
        _cc: &eframe::CreationContext<'_>,
        settings: Settings,
        handle: tokio::runtime::Handle,
        event_tx: UnboundedSender<UiEvent>,
        event_rx: UnboundedReceiver<UiEvent>,
    ) -> Self {
        let (tray_tx, tray_rx) = std::sync::mpsc::channel();
        let (cmd_tx, _cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        // Placeholder until start_backend wires the real one; its receiver
        // is dropped, so early sends are no-ops.
        let (voice_cmd_tx, _voice_cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        // Backend events also wake egui's loop, which only redraws on input.
        let event_tx = backend::EventTx::new(event_tx, _cc.egui_ctx.clone());

        let mut app = Self {
            conn: if settings.token.is_some() {
                ConnState::Connecting
            } else {
                ConnState::Disconnected("sem token".into(), None)
            },
            me: None,
            guilds: Vec::new(),
            dm_channels: Vec::new(),
            guild_channels: HashMap::new(),
            channel_index: HashMap::new(),
            messages: HashMap::new(),
            has_more: HashMap::new(),
            loading_channels: HashSet::new(),
            loading_guilds: HashSet::new(),
            unread: HashMap::new(),
            mentions: HashMap::new(),
            first_unread: HashMap::new(),
            last_seen: HashMap::new(),
            typing: HashMap::new(),
            presence: HashMap::new(),
            voice_states: HashMap::new(),
            voice: VoiceConn::Disconnected,
            desync_rejoins: Vec::new(),
            voice_users_pending: HashSet::new(),
            speaking: HashSet::new(),
            voice_muted: false,
            voice_deaf: false,
            disconnected_at: None,
            selected_guild: None,
            selected_channel: None,
            user_cache: HashMap::new(),
            images: ImageCache::new(128),
            images_large: ImageCache::new(800),
            compose: String::new(),
            compose_error: None,
            last_compose: String::new(),
            last_typing_sent: None,
            jump_to_present: false,
            settings_open: false,
            login_token: String::new(),
            dm_search: String::new(),
            // The first update() applies the theme through the live context.
            applied_theme: None,
            settings,
            handle,
            event_tx,
            event_rx,
            cmd_tx,
            backend: None,
            qr_task: None,
            voice_task: None,
            voice_cmd_tx,
            qr: QrState::Idle,
            tray_tx,
            tray_rx,
        };

        #[cfg(feature = "tray")]
        if let Err(err) = crate::tray::install(app.tray_tx.clone()) {
            log::warn!("failed to install the system tray: {err}");
        }

        // Image loaders for the animated WebP splash.
        egui_extras::install_image_loaders(&_cc.egui_ctx);

        if let Some(token) = app.settings.token.clone() {
            app.start_backend(token);
        }
        app
    }

    pub(crate) fn send(&self, command: Command) {
        let _ = self.cmd_tx.send(command);
    }

    pub(crate) fn start_backend(&mut self, token: String) {
        if let Some(task) = self.backend.take() {
            task.abort();
        }
        if let Some(task) = self.voice_task.take() {
            task.abort();
        }
        let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        self.cmd_tx = cmd_tx;
        // Voice: the gateway forwards op-4 payloads over `wire_tx`; the
        // driver task owns the actual connection (docs/VOICE.md).
        let (wire_tx, wire_rx) = tokio::sync::mpsc::unbounded_channel();
        let (voice_cmd_tx, voice_cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        self.voice_cmd_tx = voice_cmd_tx;
        self.voice_task = Some(self.handle.spawn(backend::voice::run(
            voice_cmd_rx,
            wire_rx,
            self.event_tx.clone(),
        )));
        self.backend = Some(self.handle.spawn(backend::gateway::run(
            token,
            cmd_rx,
            self.event_tx.clone(),
            wire_tx,
        )));
        self.disconnected_at = None;
        self.conn = ConnState::Connecting;
    }

    pub(crate) fn connect_from_login(&mut self) {
        let token = self.login_token.trim().to_string();
        if token.is_empty() {
            self.conn = ConnState::LoginError("Digite um token para entrar.".into());
            return;
        }
        self.login_token.clear();
        self.login_with(token);
    }

    fn login_with(&mut self, token: String) {
        self.stop_qr();
        self.settings.token = Some(token.clone());
        self.settings.save();
        self.start_backend(token);
    }

    pub(crate) fn start_qr(&mut self) {
        self.stop_qr();
        self.qr = QrState::Loading;
        self.qr_task = Some(
            self.handle
                .spawn(backend::remote_auth::run(self.event_tx.clone())),
        );
    }

    fn stop_qr(&mut self) {
        if let Some(task) = self.qr_task.take() {
            task.abort();
        }
        self.qr = QrState::Idle;
    }

    pub(crate) fn logout(&mut self) {
        if let Some(task) = self.backend.take() {
            task.abort();
        }
        if let Some(task) = self.voice_task.take() {
            task.abort();
        }
        self.settings.token = None;
        self.settings.selected_guild_id = None;
        self.settings.selected_channel_id = None;
        self.settings.save();
        self.me = None;
        self.guilds.clear();
        self.dm_channels.clear();
        self.guild_channels.clear();
        self.channel_index.clear();
        self.messages.clear();
        self.has_more.clear();
        self.loading_channels.clear();
        self.loading_guilds.clear();
        self.unread.clear();
        self.mentions.clear();
        self.first_unread.clear();
        self.last_seen.clear();
        self.typing.clear();
        self.presence.clear();
        self.selected_guild = None;
        self.selected_channel = None;
        self.user_cache.clear();
        self.compose.clear();
        self.compose_error = None;
        self.settings_open = false;
        self.login_token.clear();
        self.stop_qr();
        self.conn = ConnState::Disconnected("sessão encerrada".into(), None);
    }

    pub(crate) fn select_guild(&mut self, guild_id: &str) {
        self.selected_guild = Some(guild_id.to_string());
        self.selected_channel = None;
        self.settings.selected_guild_id = Some(guild_id.to_string());
        self.settings.selected_channel_id = None;
        if self.guild_channels.contains_key(guild_id) {
            self.restore_channel_for_guild(guild_id);
        } else {
            self.loading_guilds.insert(guild_id.to_string());
            self.send(Command::LoadGuildChannels {
                guild_id: guild_id.to_string(),
            });
        }
        self.settings.save();
    }

    pub(crate) fn select_home(&mut self) {
        self.selected_guild = None;
        self.settings.selected_guild_id = None;
        let current_is_dm = self
            .selected_channel
            .as_ref()
            .map(|id| matches!(self.channel_index.get(id), Some(ChannelRef::Dm)))
            .unwrap_or(false);
        if !current_is_dm {
            self.selected_channel = None;
            self.settings.selected_channel_id = None;
            if let Some(first_dm) = self.dm_channels.first().map(|channel| channel.id.clone()) {
                self.select_channel(first_dm);
            }
        }
        self.settings.save();
    }

    fn restore_channel_for_guild(&mut self, guild_id: &str) {
        let wanted = self.settings.last_channel_by_guild.get(guild_id).cloned();
        let chosen = match (wanted, self.guild_channels.get(guild_id)) {
            (Some(id), Some(list)) if list.iter().any(|channel| channel.id == id) => Some(id),
            _ => self
                .guild_channels
                .get(guild_id)
                .and_then(|list| list.iter().find(|channel| channel.is_selectable()))
                .map(|channel| channel.id.clone()),
        };
        if let Some(id) = chosen {
            self.select_channel(id);
        }
    }

    pub(crate) fn select_channel(&mut self, channel_id: String) {
        self.selected_channel = Some(channel_id.clone());
        self.unread.remove(&channel_id);
        self.mentions.remove(&channel_id);
        self.compose_error = None;
        if let Some(ChannelRef::Guild(guild_id)) = self.channel_index.get(&channel_id) {
            self.settings
                .last_channel_by_guild
                .insert(guild_id.clone(), channel_id.clone());
            self.settings.selected_guild_id = Some(guild_id.clone());
            self.selected_guild = Some(guild_id.clone());
        }
        self.settings.selected_channel_id = Some(channel_id.clone());
        self.settings.save();
        if !self.messages.contains_key(&channel_id) && !self.loading_channels.contains(&channel_id)
        {
            self.loading_channels.insert(channel_id.clone());
            self.send(Command::LoadMessages {
                channel_id,
                before: None,
            });
        }
    }

    pub(crate) fn send_current_message(&mut self) {
        let Some(channel_id) = self.selected_channel.clone() else {
            return;
        };
        let content = self.compose.trim().to_string();
        if content.is_empty() {
            return;
        }
        self.compose.clear();
        self.compose_error = None;
        self.send(Command::SendMessage {
            channel_id,
            content,
        });
    }

    pub(crate) fn load_older_messages(&mut self) {
        let Some(channel_id) = self.selected_channel.clone() else {
            return;
        };
        let Some(oldest) = self
            .messages
            .get(&channel_id)
            .and_then(|list| list.first().map(|message| message.id.clone()))
        else {
            return;
        };
        if self.loading_channels.contains(&channel_id) {
            return;
        }
        self.loading_channels.insert(channel_id.clone());
        self.send(Command::LoadMessages {
            channel_id,
            before: Some(oldest),
        });
    }

    /// A message that should light up the red badge: @everyone or the user.
    fn is_mention(&self, message: &Message) -> bool {
        message.mention_everyone
            || message
                .mentions
                .iter()
                .any(|user| Some(&user.id) == self.me.as_ref().map(|me| &me.id))
    }

    /// The timeline reached the bottom: everything up to `message_id` is read.
    pub(crate) fn mark_channel_read(&mut self, channel_id: &str, message_id: String) {
        self.last_seen.insert(channel_id.to_string(), message_id);
        self.first_unread.remove(channel_id);
        self.unread.remove(channel_id);
        self.mentions.remove(channel_id);
    }

    /// Whether anyone is typing in `channel_id`, pruning stale entries.
    pub(crate) fn typers(&mut self, channel_id: &str) -> Vec<String> {
        let cutoff = std::time::Instant::now() - Duration::from_secs(7);
        if let Some(map) = self.typing.get_mut(channel_id) {
            map.retain(|_, seen| *seen >= cutoff);
        }
        let mut names: Vec<String> = self
            .typing
            .get(channel_id)
            .into_iter()
            .flat_map(|map| map.keys())
            .filter_map(|id| {
                self.user_cache
                    .get(id)
                    .map(|user| user.display_name().to_string())
            })
            .collect();
        names.sort();
        names.truncate(3);
        names
    }

    /// The user typed in the compose box; tell Discord, at most every 8s.
    pub(crate) fn note_typing(&mut self) {
        if self.compose.is_empty() {
            return;
        }
        let now = std::time::Instant::now();
        if self
            .last_typing_sent
            .is_some_and(|sent| now.duration_since(sent) < Duration::from_secs(8))
        {
            return;
        }
        if let Some(channel_id) = self.selected_channel.clone() {
            self.last_typing_sent = Some(now);
            self.send(Command::SendTyping { channel_id });
        }
    }

    /// Splash "Tentar de novo": reconnect with the saved token.
    pub(crate) fn retry_connection(&mut self) {
        if let Some(token) = self.settings.token.clone() {
            self.start_backend(token);
        }
    }

    /// Click a voice channel: op 4 goes through the gateway socket and the
    /// driver task waits for Discord's state + server updates to connect.
    pub(crate) fn join_voice(&mut self, guild_id: String, channel_id: String) {
        match &self.voice {
            // A handshake is already in flight.
            VoiceConn::Connecting { .. } => return,
            VoiceConn::Connected {
                guild_id: g,
                channel_id: c,
            } if *g == guild_id && *c == channel_id => {
                return;
            }
            _ => {}
        }
        let Some(me) = &self.me else {
            return;
        };
        let user_id = me.id.clone();
        self.voice = VoiceConn::Connecting {
            guild_id: guild_id.clone(),
            channel_id: channel_id.clone(),
        };
        self.send(Command::JoinVoice {
            guild_id: guild_id.clone(),
            channel_id: channel_id.clone(),
            self_mute: self.voice_muted || self.voice_deaf,
            self_deaf: self.voice_deaf,
        });
        self.push_voice_audio_config();
        let _ = self.voice_cmd_tx.send(VoiceCommand::Join {
            guild_id,
            channel_id,
            user_id,
        });
    }

    /// Mute the microphone (op 4 flags; deafening implies it).
    pub(crate) fn set_voice_mute(&mut self, muted: bool) {
        if matches!(
            self.voice,
            VoiceConn::Disconnected | VoiceConn::Failed { .. }
        ) {
            return;
        }
        self.voice_muted = muted;
        self.send_voice_flags();
        let _ = self.voice_cmd_tx.send(VoiceCommand::SetMute { muted });
    }

    /// Deafen: stops playback locally and implies mute.
    pub(crate) fn set_voice_deaf(&mut self, deafened: bool) {
        if matches!(
            self.voice,
            VoiceConn::Disconnected | VoiceConn::Failed { .. }
        ) {
            return;
        }
        self.voice_deaf = deafened;
        self.send_voice_flags();
        let _ = self.voice_cmd_tx.send(VoiceCommand::SetDeaf { deafened });
    }

    /// op 4 for the current channel with the current flags.
    fn send_voice_flags(&mut self) {
        let Some((guild_id, channel_id)) = (match &self.voice {
            VoiceConn::Connecting {
                guild_id,
                channel_id,
            }
            | VoiceConn::Connected {
                guild_id,
                channel_id,
            } => Some((guild_id.clone(), channel_id.clone())),
            VoiceConn::Failed { .. } | VoiceConn::Disconnected => None,
        }) else {
            return;
        };
        self.send(Command::JoinVoice {
            guild_id,
            channel_id,
            self_mute: self.voice_muted || self.voice_deaf,
            self_deaf: self.voice_deaf,
        });
    }

    /// Right-click volume on a voice member: persists and feeds the mixer.
    pub(crate) fn set_user_volume(&mut self, user_id: String, percent: u8) {
        self.settings.user_volumes.insert(user_id.clone(), percent);
        self.settings.save();
        let _ = self.voice_cmd_tx.send(VoiceCommand::SetUserVolume {
            user_id,
            volume: f32::from(percent) / 100.0,
        });
    }

    /// The channel's member ids for the DAVE MLS group (the voice server
    /// never tells user accounts who else is in the call — op 11 missing).
    pub(crate) fn push_voice_roster(&mut self, channel_id: &str) {
        let users: Vec<u64> = self
            .voice_states
            .values()
            .flat_map(|roster| roster.values())
            .filter(|state| state.channel_id.as_deref() == Some(channel_id))
            .filter_map(|state| state.user_id.parse().ok())
            .collect();
        let _ = self.voice_cmd_tx.send(VoiceCommand::SetRoster(users));
    }

    /// Device names, sensitivity and noise suppression for the audio path.
    pub(crate) fn push_voice_audio_config(&mut self) {
        log::info!(
            "push config: in={:?} out={:?}",
            self.settings.input_device,
            self.settings.output_device
        );
        let _ = self.voice_cmd_tx.send(VoiceCommand::ApplyConfig {
            input_device: self.settings.input_device.clone(),
            output_device: self.settings.output_device.clone(),
            sensitivity: self.settings.input_sensitivity,
            noise_suppression: self.settings.noise_suppression,
        });
        for (user_id, percent) in &self.settings.user_volumes {
            let _ = self.voice_cmd_tx.send(VoiceCommand::SetUserVolume {
                user_id: user_id.clone(),
                volume: f32::from(*percent) / 100.0,
            });
        }
    }

    /// The panel's disconnect button, or the server removed us.
    pub(crate) fn leave_voice(&mut self) {
        if matches!(self.voice, VoiceConn::Disconnected) {
            return;
        }
        let guild_id = match &self.voice {
            VoiceConn::Connecting { guild_id, .. } | VoiceConn::Connected { guild_id, .. } => {
                Some(guild_id.clone())
            }
            VoiceConn::Failed { .. } | VoiceConn::Disconnected => None,
        };
        self.voice = VoiceConn::Disconnected;
        if let Some(guild_id) = guild_id {
            self.send(Command::LeaveVoice { guild_id });
        }
        let _ = self.voice_cmd_tx.send(VoiceCommand::Leave);
    }

    /// Members of a voice channel of the selected guild (cloned; the
    /// sidebar paints them while still mutating the app).
    pub(crate) fn voice_members(&self, channel_id: &str) -> Vec<VoiceState> {
        let Some(guild_id) = self.selected_guild.as_deref() else {
            return Vec::new();
        };
        self.voice_states
            .get(guild_id)
            .map(|states| {
                let mut members: Vec<VoiceState> = states
                    .values()
                    .filter(|state| state.channel_id.as_deref() == Some(channel_id))
                    .cloned()
                    .collect();
                members.sort_by(|a, b| a.user_id.cmp(&b.user_id));
                members
            })
            .unwrap_or_default()
    }

    /// Display name for a voice member, fetching the member record once.
    /// Empty while the fetch is in flight; the UI shows a placeholder.
    pub(crate) fn voice_member_name(&mut self, guild_id: &str, user_id: &str) -> String {
        if let Some(user) = self.user_cache.get(user_id) {
            return user.display_name().to_string();
        }
        if self.voice_users_pending.insert(user_id.to_string()) {
            self.send(Command::LoadVoiceUser {
                guild_id: guild_id.to_string(),
                user_id: user_id.to_string(),
            });
        }
        String::new()
    }

    /// Alt+↑/↓: move through the current context's channel list.
    pub(crate) fn switch_channel(&mut self, delta: i32) {
        let ids: Vec<String> = match &self.selected_guild {
            Some(guild_id) => self
                .guild_channels
                .get(guild_id)
                .map(|channels| {
                    let mut list: Vec<&Channel> = channels
                        .iter()
                        .filter(|channel| channel.is_selectable())
                        .collect();
                    list.sort_by_key(|channel| {
                        (channel.position, channel.name.clone().unwrap_or_default())
                    });
                    list.into_iter().map(|channel| channel.id.clone()).collect()
                })
                .unwrap_or_default(),
            None => self
                .dm_channels
                .iter()
                .map(|channel| channel.id.clone())
                .collect(),
        };
        if ids.is_empty() {
            return;
        }
        let next = match self
            .selected_channel
            .as_ref()
            .and_then(|id| ids.iter().position(|candidate| candidate == id))
        {
            Some(index) => (index as i64 + delta as i64).rem_euclid(ids.len() as i64) as usize,
            None => 0,
        };
        self.select_channel(ids[next].clone());
    }

    pub(crate) fn channel_name(&self, channel_id: &str) -> String {
        for channels in self.guild_channels.values() {
            if let Some(channel) = channels.iter().find(|channel| channel.id == channel_id) {
                return channel.display_name();
            }
        }
        if let Some(channel) = self
            .dm_channels
            .iter()
            .find(|channel| channel.id == channel_id)
        {
            return channel.display_name();
        }
        String::new()
    }

    pub(crate) fn channel_topic(&self, channel_id: &str) -> Option<String> {
        for channels in self.guild_channels.values() {
            if let Some(channel) = channels.iter().find(|channel| channel.id == channel_id) {
                return channel.topic.clone().filter(|topic| !topic.is_empty());
            }
        }
        self.dm_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .and_then(|channel| channel.topic.clone())
            .filter(|topic| !topic.is_empty())
    }

    /// All known channels as `id → display name`, for mention resolution.
    pub(crate) fn channel_names(&self) -> HashMap<String, String> {
        let mut names = HashMap::new();
        for channels in self.guild_channels.values() {
            for channel in channels {
                names.insert(channel.id.clone(), channel.display_name());
            }
        }
        for channel in &self.dm_channels {
            names.insert(channel.id.clone(), channel.display_name());
        }
        names
    }

    fn poll_events(&mut self, ctx: &Context) {
        while let Ok(event) = self.event_rx.try_recv() {
            self.handle_event(event);
            ctx.request_repaint();
        }
    }

    fn handle_event(&mut self, event: UiEvent) {
        match event {
            UiEvent::Connected => {
                self.disconnected_at = None;
                self.conn = ConnState::Connected;
            }
            UiEvent::Ready { user } => {
                self.user_cache.insert(user.id.clone(), user.clone());
                self.me = Some(user);
                self.disconnected_at = None;
                self.conn = ConnState::Connected;
                self.send(Command::LoadGuilds);
                self.send(Command::LoadDmChannels);
            }
            UiEvent::Disconnected { reason, retry_in } => {
                self.disconnected_at = Some(std::time::Instant::now());
                self.conn = ConnState::Disconnected(reason, retry_in)
            }
            UiEvent::TokenInvalid => {
                self.logout();
                self.conn = ConnState::LoginError(
                    "Token inválido ou expirado. Cole um novo token para entrar.".into(),
                );
            }
            UiEvent::GuildsLoaded { guilds } => {
                let restored = self
                    .settings
                    .selected_guild_id
                    .clone()
                    .filter(|id| guilds.iter().any(|guild| &guild.id == id));
                self.guilds = guilds;
                if let Some(id) = restored {
                    self.select_guild(&id);
                }
            }
            UiEvent::DmChannelsLoaded { channels } => {
                for channel in &channels {
                    self.channel_index
                        .insert(channel.id.clone(), ChannelRef::Dm);
                }
                let restored = self
                    .settings
                    .selected_channel_id
                    .clone()
                    .filter(|id| channels.iter().any(|channel| &channel.id == id));
                // Discord orders the DM list by most recent conversation;
                // the REST endpoint ignores the user's order.
                let mut channels = channels;
                channels.sort_by_key(|channel| {
                    std::cmp::Reverse(
                        channel
                            .last_message_id
                            .as_deref()
                            .and_then(|id| id.parse::<u64>().ok())
                            .unwrap_or(0),
                    )
                });
                self.dm_channels = channels;
                if self.selected_guild.is_none() && self.selected_channel.is_none() {
                    if let Some(id) = restored {
                        self.select_channel(id);
                    }
                }
            }
            UiEvent::GuildChannelsLoaded { guild_id, channels } => {
                for channel in &channels {
                    self.channel_index
                        .insert(channel.id.clone(), ChannelRef::Guild(guild_id.clone()));
                }
                self.guild_channels.insert(guild_id.clone(), channels);
                self.loading_guilds.remove(&guild_id);
                if self.selected_guild.as_deref() == Some(guild_id.as_str())
                    && self.selected_channel.is_none()
                {
                    self.restore_channel_for_guild(&guild_id);
                }
            }
            UiEvent::MessagesLoaded {
                channel_id,
                messages,
                older,
            } => {
                self.loading_channels.remove(&channel_id);
                self.has_more.insert(
                    channel_id.clone(),
                    messages.len() as u64 >= backend::api::MESSAGES_PER_PAGE,
                );
                let entry = self.messages.entry(channel_id).or_default();
                if older {
                    let mut merged = messages;
                    merged.extend(entry.drain(..));
                    *entry = merged;
                } else if entry.is_empty() {
                    *entry = messages;
                } else {
                    // A gateway echo may have raced the REST response; merge
                    // and dedupe by snowflake id.
                    let mut merged = messages;
                    merged.extend(entry.drain(..));
                    merged.sort_by(|a, b| a.id.cmp(&b.id));
                    merged.dedup_by(|a, b| a.id == b.id);
                    *entry = merged;
                }
            }
            UiEvent::MessageCreated { message } => {
                let selected =
                    self.selected_channel.as_deref() == Some(message.channel_id.as_str());
                self.user_cache
                    .insert(message.author.id.clone(), message.author.clone());
                if let Some(list) = self.messages.get_mut(&message.channel_id) {
                    if !list.iter().any(|m| m.id == message.id) {
                        // The red divider appears when the message lands while
                        // the timeline is behind the present moment.
                        let was_at_present =
                            self.last_seen.get(&message.channel_id) == list.last().map(|m| &m.id);
                        list.push(message.clone());
                        const MAX_MESSAGES: usize = 400;
                        if list.len() > MAX_MESSAGES {
                            let extra = list.len() - MAX_MESSAGES;
                            list.drain(..extra);
                            self.has_more.insert(message.channel_id.clone(), true);
                        }
                        if selected && !was_at_present && list.len() > 1 {
                            self.first_unread
                                .entry(message.channel_id.clone())
                                .or_insert_with(|| message.id.clone());
                        }
                    }
                }
                if !selected && self.channel_index.contains_key(&message.channel_id) {
                    *self.unread.entry(message.channel_id.clone()).or_insert(0) += 1;
                    if self.is_mention(&message) {
                        *self.mentions.entry(message.channel_id).or_insert(0) += 1;
                    }
                }
            }
            UiEvent::MessageUpdated {
                channel_id,
                message_id,
                content,
            } => {
                if let Some(list) = self.messages.get_mut(&channel_id) {
                    if let Some(message) = list.iter_mut().find(|m| m.id == message_id) {
                        message.content = content;
                    }
                }
            }
            UiEvent::MessageDeleted {
                channel_id,
                message_id,
            } => {
                if let Some(list) = self.messages.get_mut(&channel_id) {
                    list.retain(|message| message.id != message_id);
                }
            }
            UiEvent::TypingStart {
                channel_id,
                user_id,
            } => {
                if Some(&user_id) == self.me.as_ref().map(|me| &me.id) {
                    return;
                }
                self.user_cache
                    .entry(user_id.clone())
                    .or_insert_with(|| User {
                        id: user_id.clone(),
                        username: user_id.clone(),
                        global_name: None,
                        discriminator: None,
                        avatar: None,
                    });
                self.typing
                    .entry(channel_id)
                    .or_default()
                    .insert(user_id, std::time::Instant::now());
            }
            UiEvent::PresenceUpdate { user_id, status } => {
                self.presence.insert(user_id, status);
            }
            UiEvent::SendFailed { channel_id, error } => {
                if self.selected_channel.as_deref() == Some(channel_id.as_str()) {
                    self.compose_error = Some(error);
                } else {
                    log::warn!("failed to send in {channel_id}: {error}");
                }
            }
            UiEvent::Error { context } => log::warn!("{context}"),
            UiEvent::GuildVoiceStates { guild_id, states } => {
                let mut roster: HashMap<String, VoiceState> = HashMap::new();
                for mut state in states {
                    if state.guild_id.is_none() {
                        state.guild_id = Some(guild_id.clone());
                    }
                    roster.insert(state.user_id.clone(), state);
                }
                // The server kept us in a channel across a gateway
                // reconnect: redo the handshake so the driver comes back.
                if let Some(me) = self.me.clone()
                    && let Some(channel_id) = roster
                        .get(&me.id)
                        .and_then(|state| state.channel_id.clone())
                    && matches!(self.voice, VoiceConn::Disconnected)
                {
                    self.join_voice(guild_id.clone(), channel_id);
                }
                self.voice_states.insert(guild_id, roster);
            }
            UiEvent::VoiceStateUpdate { state } => {
                let Some(guild_id) = state.guild_id.clone() else {
                    return;
                };
                let is_me = self.me.as_ref().map(|me| &me.id) == Some(&state.user_id);
                // Dragged into a channel from another client: follow along.
                if is_me
                    && matches!(self.voice, VoiceConn::Disconnected)
                    && let Some(channel_id) = state.channel_id.clone()
                {
                    self.join_voice(guild_id.clone(), channel_id);
                }
                let user_id = state.user_id.clone();
                let state_channel = state.channel_id.clone();
                self.voice_states
                    .entry(guild_id.clone())
                    .or_default()
                    .insert(user_id.clone(), state);
                // Any roster change can mean a new DAVE member: re-seed the
                // MLS group (the voice server never tells user accounts).
                let channel_id = state_channel.or_else(|| {
                    self.voice_states
                        .get(&guild_id)
                        .and_then(|roster| roster.get(&user_id))
                        .and_then(|state| state.channel_id.clone())
                });
                if let Some(channel_id) = channel_id {
                    self.push_voice_roster(&channel_id);
                }
            }
            UiEvent::UserResolved { user } => {
                self.voice_users_pending.remove(&user.id);
                self.user_cache.insert(user.id.clone(), user);
            }
            UiEvent::VoiceConnected {
                guild_id,
                channel_id,
            } => {
                self.voice = VoiceConn::Connected {
                    guild_id,
                    channel_id: channel_id.clone(),
                };
                self.push_voice_audio_config();
                self.push_voice_roster(&channel_id);
            }
            UiEvent::VoiceFailed { error } => {
                log::warn!("voz falhou: {error}");
                self.voice = VoiceConn::Failed { error };
            }
            UiEvent::VoiceSpeaking { user_id, speaking } => {
                if speaking {
                    self.speaking.insert(user_id);
                } else {
                    self.speaking.remove(&user_id);
                }
            }
            UiEvent::VoiceSuspectDesync => {
                // Out-of-sync voice session (DAVE re-key, far-side
                // reconnect): a fresh handshake restores SSRC maps and
                // decryption keys. songbird 0.6 rolls dice per join here
                // (upstream #310), so re-roll — at most 3 times per 2
                // minutes.
                self.desync_rejoins
                    .retain(|t| Instant::now().duration_since(*t) < Duration::from_secs(120));
                if self.desync_rejoins.len() >= 3 {
                    return;
                }
                if let VoiceConn::Connected {
                    guild_id,
                    channel_id,
                } = self.voice.clone()
                {
                    log::warn!("voz fora de sincronia; refazendo a conexão");
                    self.desync_rejoins.push(Instant::now());
                    self.leave_voice();
                    self.join_voice(guild_id, channel_id);
                }
            }
            UiEvent::VoiceLeft => {
                self.voice = VoiceConn::Disconnected;
                self.speaking.clear();
            }
            UiEvent::QrReady { url } => self.qr = QrState::Code(url),
            UiEvent::QrScanned {
                username,
                user_id,
                avatar,
            } => {
                self.user_cache
                    .entry(user_id.clone())
                    .or_insert_with(|| User {
                        id: user_id.clone(),
                        username: username.clone(),
                        global_name: None,
                        discriminator: None,
                        avatar: avatar.clone(),
                    });
                self.qr = QrState::Scanned {
                    username,
                    user_id,
                    avatar,
                };
            }
            UiEvent::QrLogin { token } => self.login_with(token),
            UiEvent::QrExpired => {
                self.qr_task = None;
                self.qr = QrState::Idle;
                self.start_qr();
            }
            UiEvent::QrFailed { reason } => {
                self.qr_task = None;
                self.qr = QrState::Failed(reason);
            }
        }
    }
}

impl eframe::App for VesktopApp {
    fn ui(&mut self, root: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = &root.ctx().clone();
        if self.applied_theme != Some(self.settings.theme) {
            theme::apply(ctx, self.settings.theme);
            self.applied_theme = Some(self.settings.theme);
        }
        let target_scale =
            ctx.native_pixels_per_point().unwrap_or(1.0) * self.settings.zoom.max(0.25);
        if (ctx.pixels_per_point() - target_scale).abs() > 0.01 {
            ctx.set_pixels_per_point(target_scale);
        }

        while let Ok(command) = self.tray_rx.try_recv() {
            if matches!(command, TrayCommand::Quit) {
                self.settings.save();
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
        }

        self.poll_events(ctx);

        if self.me.is_none() {
            if self.settings.token.is_some() {
                // Saved token but no READY yet: Vesktop's own splash, which
                // covers Electron's slow startup inside the main window.
                ui::splash::show(self, root);
                ctx.request_repaint_after(Duration::from_millis(200));
            } else {
                ui::login::show(self, root);
                // Backend and QR events only land on the next frame; keep
                // polling.
                ctx.request_repaint_after(Duration::from_millis(400));
            }
            return;
        }

        // Shortcuts (docs/UI.md §5): Esc closes settings, Alt+↑/↓ moves
        // through the channel list. Ctrl+K quick switcher comes last.
        if self.settings_open && ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
            self.settings_open = false;
        }
        if ctx.input(|input| input.modifiers.alt) {
            if ctx.input(|input| input.key_pressed(egui::Key::ArrowDown)) {
                self.switch_channel(1);
            } else if ctx.input(|input| input.key_pressed(egui::Key::ArrowUp)) {
                self.switch_channel(-1);
            }
        }

        egui::Panel::left("server_rail")
            .exact_size(72.0)
            .resizable(false)
            .show(root, |ui| {
                ui::server_rail::paint(self, ui);
            });

        egui::Panel::left("channel_sidebar")
            .exact_size(240.0)
            .resizable(false)
            .show(root, |ui| {
                ui::channel_sidebar::paint(self, ui);
            });

        egui::CentralPanel::default().show(root, |ui| {
            ui::chat::paint(self, ui);
        });

        if self.settings_open {
            ui::settings_window::show(self, ctx);
        }
        if matches!(self.conn, ConnState::Connecting) {
            ctx.request_repaint_after(Duration::from_millis(400));
        }
    }
}
