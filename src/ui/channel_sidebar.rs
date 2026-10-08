//! Channel sidebar: guild channels grouped by category, or the DM list when
//! the rail's home button is selected.

use egui::{RichText, Sense, Vec2, pos2};

use crate::app::{ConnState, VesktopApp, VoiceConn};
use crate::model::{CHANNEL_KIND_CATEGORY, Channel, User, VoiceState};
use crate::theme;
use crate::ui::{draw_texture_round, initial_circle};
use crate::util;

/// Height of the user panel row, pinned so the bottom block never clips.
const USER_PANEL_H: f32 = 52.0;
const VOICE_STATUS_H: f32 = 40.0;
const VOICE_ACTIONS_H: f32 = 34.0;

pub fn paint(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);

    // The bottom block (voice status + actions + user panel) is laid out
    // manually instead of through `Panel::bottom`: egui panels reuse their
    // persisted size across runs, which clipped the growing content. Both
    // regions get explicit rects — an `allocate_rect` here would push the
    // layout cursor past the panel's bottom and empty everything above.
    let in_voice = matches!(
        app.voice,
        VoiceConn::Connecting { .. } | VoiceConn::Connected { .. }
    );
    let voice_failed = matches!(app.voice, VoiceConn::Failed { .. });
    let voice_h = if in_voice {
        VOICE_STATUS_H + 2.0 + VOICE_ACTIONS_H + 4.0
    } else if voice_failed {
        VOICE_STATUS_H + 4.0
    } else {
        0.0
    };
    let total = voice_h + USER_PANEL_H;
    let available = ui.available_rect_before_wrap();
    let block = egui::Rect::from_min_max(
        pos2(available.left(), available.bottom() - total),
        pos2(available.right(), available.bottom()),
    );
    let content_rect =
        egui::Rect::from_min_max(available.min, pos2(available.right(), block.top()));

    // Channel list: title plus scroll area, above the bottom block.
    let mut content = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(content_rect)
            .layout(egui::Layout::top_down(egui::Align::Min)),
    );
    if app.selected_guild.is_none() {
        dm_sidebar_top(app, &mut content);
    } else {
        guild_sidebar_top(app, &mut content);
    }
    egui::ScrollArea::vertical()
        .auto_shrink(false)
        .show(&mut content, |ui| {
            if app.selected_guild.is_none() {
                paint_dm_list(app, ui);
            } else {
                paint_guild_channels(app, ui);
            }
        });

    // Bottom block: voice status row, action row, user panel.
    ui.painter().rect_filled(block, 0.0, theme::RAIL);
    let mut bottom = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(block)
            .layout(egui::Layout::top_down(egui::Align::Min)),
    );
    // Explicit add_space calls do the gaps; the default 8px item spacing
    // would overflow the reserved height and get clipped.
    bottom.spacing_mut().item_spacing = Vec2::ZERO;
    voice_panel(app, &mut bottom);
    user_panel(app, &mut bottom);
}

/// Sidebar top on the Home view, Discord-style: the conversation search
/// box, the Amigos / Solicitações rows and the "Mensagens diretas" header.
fn dm_sidebar_top(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.add_space(12.0);
    ui.horizontal(|ui| {
        ui.add_space(10.0);
        let width = ui.available_width() - 10.0;
        egui::Frame::default()
            .fill(theme::RAIL)
            .stroke(egui::Stroke::new(1.0, theme::DIVIDER))
            .corner_radius(theme::RADIUS_SM)
            .inner_margin(egui::Margin::symmetric(10, 7))
            .show(ui, |ui| {
                ui.set_width(width - 16.0);
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::ZERO;
                    let (icon_slot, _) =
                        ui.allocate_exact_size(Vec2::new(16.0, 18.0), Sense::hover());
                    draw_search_icon(ui.painter(), icon_slot.center(), theme::MUTED);
                    ui.add_space(4.0);
                    let _ = ui.add(
                        egui::TextEdit::singleline(&mut app.dm_search)
                            .hint_text(
                                RichText::new("Encontre ou comece uma conversa")
                                    .color(theme::MUTED),
                            )
                            .frame(egui::Frame::NONE)
                            .desired_width(ui.available_width())
                            .font(egui::FontId::proportional(13.0)),
                    );
                });
            });
    });
    ui.add_space(10.0);
    // Amigos and Solicitações: navigation Discord shows here. The pages
    // themselves are still on the roadmap, so the rows are visual for now.
    sidebar_nav_row(ui, draw_person_icon, "Amigos");
    sidebar_nav_row(ui, draw_mail_icon, "Solicitações de mensagens");
    ui.add_space(14.0);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        ui.add_space(16.0);
        ui.label(
            RichText::new("Mensagens diretas")
                .small()
                .strong()
                .color(theme::MUTED),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.add_space(10.0);
            if nav_plus_button(ui) {
                // New-conversation picker is still on the roadmap.
            }
        });
    });
    ui.add_space(6.0);
}

/// Sidebar top on a guild: the server name with its dropdown chevron.
fn guild_sidebar_top(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.add_space(12.0);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        ui.add_space(16.0);
        let title = app
            .selected_guild
            .as_deref()
            .and_then(|id| app.guilds.iter().find(|guild| guild.id == id))
            .map(|guild| guild.name.clone())
            .unwrap_or_default();
        let (rect, response) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), 26.0), Sense::click());
        if response.hovered() {
            ui.painter()
                .rect_filled(rect, theme::RADIUS_SM, theme::HOVER);
        }
        ui.painter().text(
            pos2(rect.left(), rect.center().y),
            egui::Align2::LEFT_CENTER,
            &title,
            egui::FontId::proportional(15.5),
            theme::TEXT,
        );
        draw_chevron(
            ui.painter(),
            pos2(
                rect.left()
                    + ui.painter()
                        .layout_no_wrap(
                            title.clone(),
                            egui::FontId::proportional(15.5),
                            theme::TEXT,
                        )
                        .size()
                        .x
                    + 8.0,
                rect.center().y,
            ),
            theme::TEXT,
        );
        let _ = response
            .on_hover_text("Configurações do servidor (em breve)")
            .clicked();
    });
    ui.add_space(6.0);
}

/// A muted navigation row with a painter icon, matching Discord's
/// "Amigos" / "Solicitações de mensagens" entries.
fn sidebar_nav_row(
    ui: &mut egui::Ui,
    icon: fn(&egui::Painter, egui::Pos2, egui::Color32),
    label: &str,
) {
    let width = ui.available_width();
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 34.0), Sense::hover());
    if response.hovered() {
        ui.painter()
            .rect_filled(rect, theme::RADIUS_SM, theme::HOVER);
    }
    let mut content = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(rect)
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    content.spacing_mut().item_spacing = Vec2::ZERO;
    content.add_space(16.0);
    icon(
        content.painter(),
        pos2(content.cursor().left() + 7.0, rect.center().y),
        theme::MUTED,
    );
    content.add_space(26.0);
    content.label(RichText::new(label).size(14.0).color(theme::MUTED));
}

/// The "+" next to "Mensagens diretas": a small circle that brightens on
/// hover, like Discord's new-conversation button.
fn nav_plus_button(ui: &mut egui::Ui) -> bool {
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(18.0), Sense::click());
    let color = if response.hovered() {
        theme::TEXT
    } else {
        theme::MUTED
    };
    let stroke = egui::Stroke::new(1.6, color);
    let c = rect.center();
    ui.painter()
        .line_segment([pos2(c.x - 5.0, c.y), pos2(c.x + 5.0, c.y)], stroke);
    ui.painter()
        .line_segment([pos2(c.x, c.y - 5.0), pos2(c.x, c.y + 5.0)], stroke);
    response.on_hover_text("Nova conversa (em breve)").clicked()
}

/// The bottom block, kept in Discord's pattern (docs/UI.md §5): a "Voz
/// conectada" status row, the mic/screen/activities/sound button row, and
/// the user panel with mic/headset + chevrons.
fn user_panel(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let width = ui.available_width();
    ui.allocate_ui_with_layout(
        Vec2::new(width, USER_PANEL_H),
        egui::Layout::left_to_right(egui::Align::Center),
        |ui| {
            // Every gap below is an explicit add_space; the default 8px item
            // spacing is what pushed the gear off the panel edge.
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            ui.add_space(8.0);
            let name = app
                .me
                .as_ref()
                .map(|me| me.display_name().to_string())
                .unwrap_or_default();
            let avatar_url = app.me.as_ref().map(util::user_avatar_url);
            let texture = avatar_url
                .as_deref()
                .and_then(|url| app.images.get(ui.ctx(), &app.handle, url));
            // One allocation owns the avatar slot: painting the texture at a
            // second allocation put the photo and the status dot in
            // different places.
            let (avatar_rect, _) = ui.allocate_exact_size(Vec2::splat(32.0), Sense::hover());
            match texture {
                Some(texture) => {
                    ui.painter().image(
                        texture.id(),
                        avatar_rect,
                        egui::Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                        egui::Color32::WHITE,
                    );
                }
                None => {
                    ui.painter()
                        .circle_filled(avatar_rect.center(), 16.0, util::name_color(&name));
                }
            }
            // Own status: the client identifies as online.
            let dot = pos2(avatar_rect.min.x + 26.0, avatar_rect.min.y + 26.0);
            ui.painter().circle_filled(dot, 5.0, theme::RAIL);
            ui.painter().circle_filled(dot, 3.5, theme::GREEN);
            ui.add_space(8.0);

            // Name over the status line: "● Em voz" while connected, else the
            // gateway state. Truncated so the buttons never overlap it.
            let in_voice = matches!(
                app.voice,
                VoiceConn::Connecting { .. } | VoiceConn::Connected { .. }
            );
            let (line, color) = if in_voice {
                ("● Em voz".to_string(), theme::GREEN)
            } else {
                match &app.conn {
                    ConnState::Disconnected(..) => ("Reconectando…".to_string(), theme::YELLOW),
                    ConnState::Connecting => ("Conectando…".to_string(), theme::MUTED),
                    _ => ("Disponível.".to_string(), theme::GREEN),
                }
            };
            // Control cluster: [mic ⌄] [headset ⌄] [gear] — 20px icons, 12px
            // chevrons, 2px inside a pair and 4px between pairs, plus 8px of
            // right padding.
            let buttons_width = 5.0 * 2.0 + 3.0 * 20.0 + 2.0 * 12.0 + 8.0;
            let name_width = (width - 8.0 - 32.0 - 8.0 - buttons_width).max(40.0);
            ui.allocate_ui_with_layout(
                Vec2::new(name_width, 32.0),
                egui::Layout::top_down(egui::Align::Min),
                |ui| {
                    ui.add_space(2.0);
                    ui.add(
                        egui::Label::new(
                            RichText::new(&name).size(14.0).strong().color(theme::TEXT),
                        )
                        .truncate(),
                    );
                    ui.label(RichText::new(line).small().color(color));
                },
            );

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                ui.add_space(8.0);
                if compact_button(ui, "Configurações", |painter, center, color| {
                    painter.text(
                        center,
                        egui::Align2::CENTER_CENTER,
                        "⚙",
                        egui::FontId::proportional(14.0),
                        color,
                    );
                }) {
                    app.settings_open = !app.settings_open;
                }
                ui.add_space(4.0);
                // Right-to-left layout places each new widget to the left of
                // the previous one, so a chevron is added *before* its icon
                // to render on the icon's right, Discord-style.
                let deaf = app.voice_deaf;
                compact_button(ui, "Dispositivos de áudio (em breve)", draw_chevron);
                if compact_button(
                    ui,
                    if deaf {
                        "Ativar áudio"
                    } else {
                        "Silenciar áudio (surdo)"
                    },
                    |painter, center, color| draw_headset(painter, center, color, deaf),
                ) {
                    app.set_voice_deaf(!deaf);
                }
                let muted = app.voice_muted;
                compact_button(ui, "Dispositivos de voz (em breve)", draw_chevron);
                if compact_button_accent(
                    ui,
                    if muted {
                        "Ativar microfone"
                    } else {
                        "Silenciar microfone"
                    },
                    if muted { Some(theme::RED) } else { None },
                    |painter, center, color| draw_mic(painter, center, color, muted),
                ) {
                    app.set_voice_mute(!muted);
                }
            });
        },
    );
}

/// Like `compact_button`, with an optional accent fill — the red rounded
/// box Discord puts behind the mic while it is muted.
fn compact_button_accent(
    ui: &mut egui::Ui,
    tooltip: &str,
    accent: Option<egui::Color32>,
    draw: impl FnOnce(&egui::Painter, egui::Pos2, egui::Color32),
) -> bool {
    let (rect, response) = ui.allocate_exact_size(Vec2::new(20.0, 26.0), Sense::click());
    if let Some(fill) = accent {
        ui.painter().rect_filled(rect, 4.0, fill);
    } else if response.hovered() {
        ui.painter().rect_filled(rect, 4.0, theme::HOVER);
    }
    let color = if accent.is_some() || response.hovered() {
        theme::WHITE
    } else {
        theme::TEXT
    };
    draw(ui.painter(), rect.center(), color);
    response.on_hover_text(tooltip).clicked()
}

/// Frameless icon button, Discord-style: a subtle box only while hovered.
/// The glyph is a painter callback so icons stay crisp — emoji fonts miss
/// half these symbols and render tofu boxes.
fn compact_button(
    ui: &mut egui::Ui,
    tooltip: &str,
    draw: impl FnOnce(&egui::Painter, egui::Pos2, egui::Color32),
) -> bool {
    let (rect, response) = ui.allocate_exact_size(Vec2::new(20.0, 26.0), Sense::click());
    if response.hovered() {
        ui.painter().rect_filled(rect, 4.0, theme::HOVER);
    }
    let color = if response.hovered() {
        theme::WHITE
    } else {
        theme::TEXT
    };
    draw(ui.painter(), rect.center(), color);
    response.on_hover_text(tooltip).clicked()
}

/// Microphone: capsule, U-shaped stand and stem; red slash when muted.
fn draw_mic(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32, muted: bool) {
    let stroke = egui::Stroke::new(1.6, color);
    let cx = center.x;
    let top = center.y - 8.5;
    painter.rect_filled(
        egui::Rect::from_min_size(pos2(cx - 3.0, top), Vec2::new(6.0, 11.0)),
        3.0,
        color,
    );
    let stand_top = top + 11.0;
    let stand_bottom = stand_top + 4.0;
    painter.line_segment(
        [pos2(cx - 5.0, stand_top), pos2(cx - 5.0, stand_bottom)],
        stroke,
    );
    painter.line_segment(
        [pos2(cx + 5.0, stand_top), pos2(cx + 5.0, stand_bottom)],
        stroke,
    );
    painter.line_segment(
        [pos2(cx - 5.0, stand_bottom), pos2(cx + 5.0, stand_bottom)],
        stroke,
    );
    painter.line_segment(
        [pos2(cx, stand_bottom), pos2(cx, stand_bottom + 4.0)],
        stroke,
    );
    if muted {
        painter.line_segment(
            [
                pos2(cx - 8.0, center.y - 9.0),
                pos2(cx + 8.0, center.y + 9.0),
            ],
            egui::Stroke::new(2.2, theme::RED),
        );
    }
}

/// Headset: headband arc and two ear cups; red slash when deafened.
fn draw_headset(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32, deaf: bool) {
    let stroke = egui::Stroke::new(1.6, color);
    let cx = center.x;
    let cy = center.y + 2.0;
    let r = 6.5;
    let arc: Vec<egui::Pos2> = (0..=8)
        .map(|i| {
            let angle = std::f32::consts::PI * i as f32 / 8.0;
            pos2(cx - r * angle.cos(), cy - r * angle.sin())
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
    painter.rect_filled(
        egui::Rect::from_min_size(pos2(cx - r - 1.5, cy - 2.0), Vec2::new(3.5, 7.0)),
        1.5,
        color,
    );
    painter.rect_filled(
        egui::Rect::from_min_size(pos2(cx + r - 2.0, cy - 2.0), Vec2::new(3.5, 7.0)),
        1.5,
        color,
    );
    if deaf {
        painter.line_segment(
            [
                pos2(cx - 8.0, center.y - 9.0),
                pos2(cx + 8.0, center.y + 9.0),
            ],
            egui::Stroke::new(2.2, theme::RED),
        );
    }
}

/// Small downward options chevron.
fn draw_chevron(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.6, color);
    painter.line_segment(
        [
            pos2(center.x - 3.0, center.y - 1.5),
            pos2(center.x, center.y + 1.5),
        ],
        stroke,
    );
    painter.line_segment(
        [
            pos2(center.x, center.y + 1.5),
            pos2(center.x + 3.0, center.y - 1.5),
        ],
        stroke,
    );
}

/// Magnifying glass for the conversation search box.
pub(crate) fn draw_search_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.5, color);
    painter.circle_stroke(pos2(center.x - 0.5, center.y - 0.5), 4.5, stroke);
    painter.line_segment(
        [
            pos2(center.x + 3.0, center.y + 3.0),
            pos2(center.x + 6.5, center.y + 6.5),
        ],
        stroke,
    );
}

/// Person silhouette for the "Amigos" row: head plus shoulders.
fn draw_person_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
    painter.circle_filled(pos2(center.x, center.y - 3.5), 3.0, color);
    let shoulders =
        egui::Rect::from_min_size(pos2(center.x - 5.0, center.y + 0.5), Vec2::new(10.0, 6.0));
    painter.rect_filled(shoulders, 4.0, color);
}

/// Envelope for the "Solicitações de mensagens" row.
fn draw_mail_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.4, color);
    let rect = egui::Rect::from_center_size(center, Vec2::new(12.0, 9.0));
    painter.rect_stroke(rect, 1.5, stroke, egui::StrokeKind::Inside);
    painter.line_segment(
        [
            pos2(rect.left() + 0.5, rect.top() + 0.5),
            pos2(center.x, center.y + 1.0),
        ],
        stroke,
    );
    painter.line_segment(
        [
            pos2(center.x, center.y + 1.0),
            pos2(rect.right() - 0.5, rect.top() + 0.5),
        ],
        stroke,
    );
}

/// The "Voz conectada" block above the user panel, Discord-style: a status
/// row (signal icon, green title, "canal / servidor") plus the mic / screen
/// share / activities / soundboard button row. Absent while disconnected;
/// the phone button also dismisses a failed attempt.
fn voice_panel(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let status = app.voice.clone();
    let (accent, title, channel_id, guild_id, error) = match &status {
        VoiceConn::Disconnected => return,
        VoiceConn::Failed { error } => (
            theme::RED,
            "Falha na voz".to_string(),
            None,
            None,
            Some(error.clone()),
        ),
        VoiceConn::Connecting {
            guild_id,
            channel_id,
        } => (
            theme::YELLOW,
            "Conectando…".to_string(),
            Some(channel_id.clone()),
            Some(guild_id.clone()),
            None,
        ),
        VoiceConn::Connected {
            guild_id,
            channel_id,
        } => (
            theme::GREEN,
            "Voz conectada".to_string(),
            Some(channel_id.clone()),
            Some(guild_id.clone()),
            None,
        ),
    };

    let in_voice = channel_id.is_some();
    let subtitle = match (&channel_id, &guild_id) {
        (Some(channel_id), Some(guild_id)) => {
            let guild = app
                .guilds
                .iter()
                .find(|guild| &guild.id == guild_id)
                .map(|guild| guild.name.clone())
                .unwrap_or_default();
            let channel = app.channel_name(channel_id);
            if channel.is_empty() {
                guild
            } else if guild.is_empty() {
                channel
            } else {
                format!("{channel} / {guild}")
            }
        }
        _ => error.clone().unwrap_or_default(),
    };

    // Status row.
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(Vec2::new(width, 40.0), Sense::hover());
    ui.painter().rect_filled(rect, 0.0, theme::RAIL);
    signal_icon(ui, theme::GREEN, pos2(rect.left() + 12.0, rect.center().y));
    ui.painter().text(
        pos2(rect.left() + 34.0, rect.center().y - 8.0),
        egui::Align2::LEFT_CENTER,
        &title,
        egui::FontId::proportional(13.5),
        accent,
    );
    if !subtitle.is_empty() {
        ui.painter().text(
            pos2(rect.left() + 34.0, rect.center().y + 9.0),
            egui::Align2::LEFT_CENTER,
            &subtitle,
            egui::FontId::proportional(11.5),
            theme::MUTED,
        );
    }
    let mut leave = false;
    ui.painter().text(
        pos2(rect.right() - 22.0, rect.center().y),
        egui::Align2::CENTER_CENTER,
        "📴",
        egui::FontId::proportional(15.0),
        theme::RED,
    );
    let disconnect = egui::Rect::from_center_size(
        pos2(rect.right() - 22.0, rect.center().y),
        Vec2::splat(28.0),
    );
    if ui
        .interact(
            disconnect,
            egui::Id::new("voice_disconnect"),
            Sense::click(),
        )
        .on_hover_text("Desconectar da voz")
        .clicked()
    {
        leave = true;
    }

    // Action row: mic, screen share, activities, soundboard.
    if in_voice {
        ui.add_space(2.0);
        let width = ui.available_width();
        ui.allocate_ui_with_layout(
            Vec2::new(width, VOICE_ACTIONS_H),
            egui::Layout::left_to_right(egui::Align::Center),
            |ui| {
                ui.add_space(8.0);
                let gap = 6.0;
                let button_width = (width - 16.0 - 3.0 * gap) / 4.0;
                let action = |ui: &mut egui::Ui, glyph: &str, color, tooltip: &str| {
                    ui.add_sized(
                        [button_width, VOICE_ACTIONS_H],
                        egui::Button::new(RichText::new(glyph).color(color).size(15.0)),
                    )
                    .on_hover_text(tooltip)
                    .clicked()
                };
                let mic_color = if app.voice_muted {
                    theme::RED
                } else {
                    theme::TEXT
                };
                if action(
                    ui,
                    if app.voice_muted { "🎙" } else { "🎤" },
                    mic_color,
                    if app.voice_muted {
                        "Ativar microfone"
                    } else {
                        "Silenciar microfone"
                    },
                ) {
                    app.set_voice_mute(!app.voice_muted);
                }
                let _ = action(ui, "🖥️", theme::TEXT, "Compartilhar tela (em breve)");
                let _ = action(ui, "🎯", theme::TEXT, "Atividades (em breve)");
                let _ = action(ui, "🎵", theme::TEXT, "Soundboard (em breve)");
                ui.add_space(8.0);
            },
        );
    }
    ui.add_space(4.0);

    if leave {
        app.leave_voice();
    }
}

/// Three ascending signal bars, Discord's connected-voice glyph.
fn signal_icon(ui: &mut egui::Ui, color: egui::Color32, center: egui::Pos2) {
    let painter = ui.painter();
    for (index, height) in [5.0, 9.0, 13.0].into_iter().enumerate() {
        let x = center.x + index as f32 * 5.0 - 5.0;
        painter.rect_filled(
            egui::Rect::from_min_size(pos2(x, center.y - height / 2.0), Vec2::new(3.0, height)),
            1.0,
            color,
        );
    }
}

/// A member under a voice channel: avatar (green ring while speaking),
/// name, mute/deaf icons and a right-click volume slider.
fn voice_member_row(app: &mut VesktopApp, ui: &mut egui::Ui, guild_id: &str, member: &VoiceState) {
    let fetched = app.voice_member_name(guild_id, &member.user_id);
    let label = if fetched.is_empty() {
        "…".to_string()
    } else {
        fetched
    };
    let speaking = app.speaking.contains(&member.user_id);
    let width = ui.available_width();
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 34.0), Sense::hover());
    let mut content = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(egui::Rect::from_min_max(
                pos2(rect.left() + 34.0, rect.top() + 1.0),
                pos2(rect.right() - 8.0, rect.bottom() - 1.0),
            ))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    let (avatar_left, avatar_top) = {
        let cursor = content.cursor();
        (cursor.left(), cursor.top())
    };
    // The avatar comes from the resolved member; the letter circle is only
    // the fallback while the member lookup is still in flight.
    let member_user = app.user_cache.get(&member.user_id).cloned();
    let avatar_texture = member_user.as_ref().and_then(|user| {
        let url = util::user_avatar_url(user);
        app.images.get(content.ctx(), &app.handle, &url)
    });
    match avatar_texture {
        Some(texture) => draw_texture_round(&mut content, &texture, 18.0),
        None => initial_circle(&mut content, 18.0, &label, util::name_color(&label)),
    }
    if speaking {
        content.painter().circle_stroke(
            pos2(avatar_left + 9.0, avatar_top + 9.0),
            10.5,
            egui::Stroke::new(2.0, theme::GREEN),
        );
    }
    content.add_space(6.0);
    // Server mute/deafen wins over the self flags visually.
    let icons = if member.deaf || member.self_deaf {
        " 🎧"
    } else if member.mute || member.self_mute {
        " 🔇"
    } else {
        ""
    };
    content.label(
        RichText::new(format!("{label}{icons}"))
            .size(13.0)
            .color(theme::MUTED),
    );

    let mut percent = *app
        .settings
        .user_volumes
        .get(&member.user_id)
        .unwrap_or(&100);
    response.context_menu(|ui| {
        ui.set_min_width(180.0);
        ui.label(RichText::new(&label).strong().size(13.0));
        if ui
            .add(egui::Slider::new(&mut percent, 0..=200).text("Volume"))
            .changed()
        {
            app.set_user_volume(member.user_id.clone(), percent);
        }
    });
}

fn paint_dm_list(app: &mut VesktopApp, ui: &mut egui::Ui) {
    if app.dm_channels.is_empty() {
        ui.add_space(8.0);
        ui.label(
            RichText::new("Nenhuma conversa ainda.")
                .small()
                .color(theme::MUTED),
        );
        return;
    }
    let dms = app.dm_channels.clone();
    let mut clicked: Option<String> = None;
    let needle = app.dm_search.trim().to_lowercase();
    for channel in dms {
        let name = channel.display_name();
        if !needle.is_empty() && !name.to_lowercase().contains(&needle) {
            continue;
        }
        let selected = app.selected_channel.as_deref() == Some(channel.id.as_str());
        let unread = app.unread.get(&channel.id).copied().unwrap_or(0) > 0;
        let avatar_user = channel.recipients.first();
        let response = row(app, ui, avatar_user, "", &name, selected, unread, false);
        if response.clicked() {
            clicked = Some(channel.id.clone());
        }
    }
    if let Some(id) = clicked {
        app.select_channel(id);
    }
}

fn paint_guild_channels(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let Some(guild_id) = app.selected_guild.clone() else {
        return;
    };
    if !app.guild_channels.contains_key(&guild_id) {
        ui.add_space(8.0);
        ui.label(
            RichText::new("Carregando canais…")
                .small()
                .color(theme::MUTED),
        );
        return;
    }
    let channels = app
        .guild_channels
        .get(&guild_id)
        .cloned()
        .unwrap_or_default();
    let selected = app.selected_channel.clone();
    let mut clicked: Option<String> = None;
    let mut clicked_voice: Option<String> = None;

    let render = |app: &mut VesktopApp,
                  ui: &mut egui::Ui,
                  channel: &Channel,
                  clicked: &mut Option<String>,
                  clicked_voice: &mut Option<String>| {
        let is_selected = selected.as_deref() == Some(channel.id.as_str());
        let unread = app.unread.get(&channel.id).copied().unwrap_or(0) > 0;
        let name = channel.display_name();
        if channel.is_voice() {
            // Highlight the channel we are connecting to or in.
            let active = match &app.voice {
                VoiceConn::Connecting { channel_id, .. }
                | VoiceConn::Connected { channel_id, .. } => channel_id == &channel.id,
                _ => false,
            };
            if row(app, ui, None, "🔊", &name, active, unread, false).clicked() {
                *clicked_voice = Some(channel.id.clone());
            }
            for member in app.voice_members(&channel.id) {
                voice_member_row(app, ui, &guild_id, &member);
            }
        } else {
            let prefix = if channel.kind == crate::model::CHANNEL_KIND_ANNOUNCEMENT {
                "📣 "
            } else {
                "#"
            };
            if row(app, ui, None, prefix, &name, is_selected, unread, false).clicked() {
                *clicked = Some(channel.id.clone());
            }
        }
    };

    // Uncategorized channels first, then each category with its children.
    let mut ungrouped: Vec<&Channel> = channels
        .iter()
        .filter(|channel| channel.parent_id.is_none() && channel.kind != CHANNEL_KIND_CATEGORY)
        .collect();
    ungrouped.sort_by_key(|channel| (channel.position, channel.name.clone().unwrap_or_default()));
    for channel in ungrouped {
        render(app, ui, channel, &mut clicked, &mut clicked_voice);
    }

    let mut categories: Vec<&Channel> = channels
        .iter()
        .filter(|channel| channel.kind == CHANNEL_KIND_CATEGORY)
        .collect();
    categories.sort_by_key(|channel| (channel.position, channel.name.clone().unwrap_or_default()));
    for category in categories {
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.add_space(10.0);
            ui.label(
                RichText::new(category.display_name().to_uppercase())
                    .small()
                    .strong()
                    .color(theme::MUTED),
            );
        });
        let mut children: Vec<&Channel> = channels
            .iter()
            .filter(|channel| channel.parent_id.as_deref() == Some(category.id.as_str()))
            .collect();
        children
            .sort_by_key(|channel| (channel.position, channel.name.clone().unwrap_or_default()));
        for channel in children {
            render(app, ui, channel, &mut clicked, &mut clicked_voice);
        }
    }

    if let Some(id) = clicked {
        app.select_channel(id);
    }
    if let Some(id) = clicked_voice {
        app.join_voice(guild_id.clone(), id);
    }
}

#[allow(clippy::too_many_arguments)]
fn row(
    app: &mut VesktopApp,
    ui: &mut egui::Ui,
    avatar_user: Option<&User>,
    prefix: &str,
    label: &str,
    selected: bool,
    unread: bool,
    dimmed: bool,
) -> egui::Response {
    let width = ui.available_width();
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 40.0), Sense::click());
    let bg = if selected {
        theme::SELECTED
    } else if response.hovered() && !dimmed {
        theme::HOVER
    } else {
        theme::SIDEBAR
    };
    ui.painter().rect_filled(rect, 6.0, bg);

    let mut content = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(egui::Rect::from_min_max(
                pos2(rect.left() + 10.0, rect.top() + 3.0),
                pos2(rect.right() - 8.0, rect.bottom() - 3.0),
            ))
            .layout(egui::Layout::left_to_right(egui::Align::Center)),
    );
    if let Some(user) = avatar_user {
        let url = util::user_avatar_url(user);
        let (avatar_left, avatar_top) = {
            let cursor = content.cursor();
            (cursor.left(), cursor.top())
        };
        match app.images.get(ui.ctx(), &app.handle, &url) {
            Some(texture) => draw_texture_round(&mut content, &texture, 26.0),
            None => initial_circle(
                &mut content,
                26.0,
                user.display_name(),
                util::name_color(user.display_name()),
            ),
        }
        // Presence dot, Discord-style, on the avatar's bottom-right.
        if let Some(status) = app.presence.get(&user.id) {
            let center = pos2(avatar_left + 22.0, avatar_top + 22.0);
            let color = match status.as_str() {
                "online" => theme::GREEN,
                "idle" => theme::YELLOW,
                "dnd" => theme::RED,
                _ => theme::MUTED,
            };
            content.painter().circle_filled(center, 6.0, theme::SIDEBAR);
            content.painter().circle_filled(center, 4.5, color);
        }
        content.add_space(8.0);
    }
    let mut text = RichText::new(format!("{prefix}{label}")).size(14.5);
    text = if unread {
        text.strong().color(theme::TEXT)
    } else if dimmed {
        text.color(theme::MUTED)
    } else {
        text.color(theme::TEXT)
    };
    content.label(text);
    response
}
