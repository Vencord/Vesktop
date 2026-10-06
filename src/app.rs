//! Application state and root UI orchestration: panels, event routing,
//! selection bookkeeping and settings persistence.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use egui::Context;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;

use crate::backend::{self, Command, UiEvent};
use crate::image_cache::ImageCache;
use crate::model::{Channel, Guild, Message, User};
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
    Disconnected(String),
    LoginError(String),
}

/// How a channel id maps back to its owner, for unread routing and titles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChannelRef {
    Guild(String),
    Dm,
}

pub struct VesktopApp {
    pub(crate) settings: Settings,
    pub(crate) handle: tokio::runtime::Handle,
    event_tx: UnboundedSender<UiEvent>,
    pub(crate) event_rx: UnboundedReceiver<UiEvent>,
    pub(crate) cmd_tx: UnboundedSender<Command>,
    backend: Option<JoinHandle<()>>,
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
    pub(crate) selected_guild: Option<String>,
    pub(crate) selected_channel: Option<String>,
    pub(crate) user_cache: HashMap<String, User>,
    pub(crate) images: ImageCache,

    pub(crate) compose: String,
    pub(crate) compose_error: Option<String>,
    pub(crate) settings_open: bool,
    pub(crate) login_token: String,
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

        let mut app = Self {
            conn: if settings.token.is_some() {
                ConnState::Connecting
            } else {
                ConnState::Disconnected("sem token".into())
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
            selected_guild: None,
            selected_channel: None,
            user_cache: HashMap::new(),
            images: ImageCache::new(128),
            compose: String::new(),
            compose_error: None,
            settings_open: false,
            login_token: String::new(),
            // The first update() applies the theme through the live context.
            applied_theme: None,
            settings,
            handle,
            event_tx,
            event_rx,
            cmd_tx,
            backend: None,
            tray_tx,
            tray_rx,
        };

        #[cfg(feature = "tray")]
        if let Err(err) = crate::tray::install(app.tray_tx.clone()) {
            log::warn!("failed to install the system tray: {err}");
        }

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
        let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        self.cmd_tx = cmd_tx;
        self.backend = Some(self.handle.spawn(backend::gateway::run(
            token,
            cmd_rx,
            self.event_tx.clone(),
        )));
        self.conn = ConnState::Connecting;
    }

    pub(crate) fn connect_from_login(&mut self) {
        let token = self.login_token.trim().to_string();
        if token.is_empty() {
            self.conn = ConnState::LoginError("Digite um token para entrar.".into());
            return;
        }
        self.login_token.clear();
        self.settings.token = Some(token.clone());
        self.settings.save();
        self.start_backend(token);
    }

    pub(crate) fn logout(&mut self) {
        if let Some(task) = self.backend.take() {
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
        self.selected_guild = None;
        self.selected_channel = None;
        self.user_cache.clear();
        self.compose.clear();
        self.compose_error = None;
        self.settings_open = false;
        self.login_token.clear();
        self.conn = ConnState::Disconnected("sessão encerrada".into());
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
        if !self.messages.contains_key(&channel_id) && !self.loading_channels.contains(&channel_id) {
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

    pub(crate) fn channel_name(&self, channel_id: &str) -> String {
        for channels in self.guild_channels.values() {
            if let Some(channel) = channels.iter().find(|channel| channel.id == channel_id) {
                return channel.display_name();
            }
        }
        if let Some(channel) = self.dm_channels.iter().find(|channel| channel.id == channel_id) {
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
            UiEvent::Connected => self.conn = ConnState::Connected,
            UiEvent::Ready { user } => {
                self.user_cache.insert(user.id.clone(), user.clone());
                self.me = Some(user);
                self.conn = ConnState::Connected;
                self.send(Command::LoadGuilds);
                self.send(Command::LoadDmChannels);
            }
            UiEvent::Disconnected { reason } => self.conn = ConnState::Disconnected(reason),
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
                let selected = self
                    .selected_channel
                    .as_deref()
                    == Some(message.channel_id.as_str());
                self.user_cache
                    .insert(message.author.id.clone(), message.author.clone());
                if let Some(list) = self.messages.get_mut(&message.channel_id) {
                    if !list.iter().any(|m| m.id == message.id) {
                        list.push(message.clone());
                        const MAX_MESSAGES: usize = 400;
                        if list.len() > MAX_MESSAGES {
                            let extra = list.len() - MAX_MESSAGES;
                            list.drain(..extra);
                            self.has_more
                                .insert(message.channel_id.clone(), true);
                        }
                    }
                }
                if !selected && self.channel_index.contains_key(&message.channel_id) {
                    *self.unread.entry(message.channel_id).or_insert(0) += 1;
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
            UiEvent::SendFailed { channel_id, error } => {
                if self.selected_channel.as_deref() == Some(channel_id.as_str()) {
                    self.compose_error = Some(error);
                } else {
                    log::warn!("failed to send in {channel_id}: {error}");
                }
            }
            UiEvent::Error { context } => log::warn!("{context}"),
        }
    }
}

impl eframe::App for VesktopApp {
    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
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
            ui::login::show(self, ctx);
            if matches!(self.conn, ConnState::Connecting) {
                ctx.request_repaint_after(Duration::from_millis(400));
            }
            return;
        }

        egui::TopBottomPanel::bottom("status_bar").show(ctx, |ui| {
            ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
            ui.horizontal(|ui| {
                ui.add_space(10.0);
                let (dot, label) = match &self.conn {
                    ConnState::Connected => (theme::GREEN, "Conectado".to_string()),
                    ConnState::Connecting => {
                        (egui::Color32::YELLOW, "Conectando…".to_string())
                    }
                    ConnState::Disconnected(reason) => {
                        (theme::RED, format!("Desconectado — {reason}"))
                    }
                    ConnState::LoginError(message) => (theme::RED, message.clone()),
                };
                ui.label(egui::RichText::new("●").color(dot));
                ui.label(egui::RichText::new(label).small().color(theme::MUTED));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("⚙").clicked() {
                        self.settings_open = !self.settings_open;
                    }
                    if let Some(user) = &self.me {
                        ui.label(
                            egui::RichText::new(user.display_name())
                                .small()
                                .color(theme::TEXT),
                        );
                    }
                });
                ui.add_space(10.0);
            });
        });

        egui::SidePanel::left("server_rail")
            .exact_width(72.0)
            .resizable(false)
            .show(ctx, |ui| {
                ui::server_rail::paint(self, ui);
            });

        egui::SidePanel::left("channel_sidebar")
            .exact_width(240.0)
            .resizable(false)
            .show(ctx, |ui| {
                ui::channel_sidebar::paint(self, ui);
            });

        egui::CentralPanel::default().show(ctx, |ui| {
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
