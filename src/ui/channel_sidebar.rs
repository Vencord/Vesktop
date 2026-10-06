//! Channel sidebar: guild channels grouped by category, or the DM list when
//! the rail's home button is selected.

use egui::{RichText, Sense, Vec2, pos2};

use crate::app::VesktopApp;
use crate::model::{Channel, User, CHANNEL_KIND_CATEGORY};
use crate::theme;
use crate::ui::{draw_texture, initial_circle};
use crate::util;

pub fn paint(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.painter().rect_filled(ui.max_rect(), 0.0, theme::SIDEBAR);
    ui.add_space(10.0);

    ui.horizontal(|ui| {
        ui.add_space(16.0);
        let title = app
            .selected_guild
            .as_deref()
            .and_then(|id| app.guilds.iter().find(|guild| guild.id == id))
            .map(|guild| guild.name.clone())
            .unwrap_or_else(|| "Mensagens diretas".to_string());
        ui.label(RichText::new(title).strong().size(16.0).color(theme::TEXT));
    });
    ui.add_space(6.0);

    egui::ScrollArea::vertical()
        .auto_shrink(false)
        .show(ui, |ui| {
            if app.selected_guild.is_none() {
                paint_dm_list(app, ui);
            } else {
                paint_guild_channels(app, ui);
            }
        });
}

fn paint_dm_list(app: &mut VesktopApp, ui: &mut egui::Ui) {
    if app.dm_channels.is_empty() {
        ui.add_space(8.0);
        ui.label(RichText::new("Nenhuma conversa ainda.").small().color(theme::MUTED));
        return;
    }
    let dms = app.dm_channels.clone();
    let mut clicked: Option<String> = None;
    for channel in dms {
        let selected = app.selected_channel.as_deref() == Some(channel.id.as_str());
        let unread = app.unread.get(&channel.id).copied().unwrap_or(0) > 0;
        let name = channel.display_name();
        let avatar_user = channel.recipients.first();
        let response = row(
            app,
            ui,
            avatar_user,
            "",
            &name,
            selected,
            unread,
            false,
        );
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
        ui.label(RichText::new("Carregando canais…").small().color(theme::MUTED));
        return;
    }
    let channels = app.guild_channels.get(&guild_id).cloned().unwrap_or_default();
    let selected = app.selected_channel.clone();
    let mut clicked: Option<String> = None;

    let mut render = |app: &mut VesktopApp,
                      ui: &mut egui::Ui,
                      channel: &Channel,
                      clicked: &mut Option<String>| {
        let is_selected = selected.as_deref() == Some(channel.id.as_str());
        let unread = app.unread.get(&channel.id).copied().unwrap_or(0) > 0;
        let name = channel.display_name();
        if channel.is_voice() {
            let response = row(app, ui, None, "🔊", &name, is_selected, unread, true)
                .on_hover_text("Canais de voz ainda não são suportados neste port nativo.");
            let _ = response;
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
        .filter(|channel| {
            channel.parent_id.is_none() && channel.kind != CHANNEL_KIND_CATEGORY
        })
        .collect();
    ungrouped.sort_by_key(|channel| (channel.position, channel.name.clone().unwrap_or_default()));
    for channel in ungrouped {
        render(app, ui, channel, &mut clicked);
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
            render(app, ui, channel, &mut clicked);
        }
    }

    if let Some(id) = clicked {
        app.select_channel(id);
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
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 36.0), Sense::click());
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
        match app.images.get(ui.ctx(), &app.handle, &url) {
            Some(texture) => draw_texture(&content, &texture, Vec2::splat(26.0)),
            None => initial_circle(
                &content,
                26.0,
                user.display_name(),
                util::name_color(user.display_name()),
            ),
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
