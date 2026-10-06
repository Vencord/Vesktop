//! Left rail: the DMs home button and the guild icon list, painted with
//! circles and letters while icons load.

use egui::{Align2, Color32, FontId, Response, Sense, TextureHandle, Vec2, pos2};

use crate::app::{ChannelRef, VesktopApp};
use crate::theme;
use crate::util;

pub fn paint(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
    ui.add_space(10.0);

    let dm_unread: u64 = app
        .unread
        .iter()
        .filter(|(id, _)| matches!(app.channel_index.get(*id), Some(ChannelRef::Dm)))
        .map(|(_, count)| *count)
        .sum();
    let home_selected = app.selected_guild.is_none();
    if rail_button(
        ui,
        home_selected,
        dm_unread > 0,
        "V",
        theme::BLURPLE,
        None,
        "Mensagens diretas",
    )
    .clicked()
    {
        app.select_home();
    }
    ui.add_space(10.0);

    let mut clicked: Option<String> = None;
    let guilds = app.guilds.clone();
    for guild in guilds {
        let selected = app.selected_guild.as_deref() == Some(guild.id.as_str());
        let unread = app.unread.iter().any(|(id, count)| {
            *count > 0
                && matches!(app.channel_index.get(id), Some(ChannelRef::Guild(owner)) if owner == &guild.id)
        });
        let texture = util::guild_icon_url(&guild)
            .and_then(|url| app.images.get(ui.ctx(), &app.handle, &url));
        let response = rail_button(
            ui,
            selected,
            unread,
            initial(&guild.name),
            theme::INPUT,
            texture.as_ref(),
            &guild.name,
        );
        if response.clicked() {
            clicked = Some(guild.id.clone());
        }
        ui.add_space(8.0);
    }
    if let Some(id) = clicked {
        app.select_guild(&id);
    }
}

fn initial(name: &str) -> String {
    name.chars()
        .next()
        .map(|c| c.to_uppercase().collect())
        .unwrap_or_else(|| "?".to_string())
}

#[allow(clippy::too_many_arguments)]
fn rail_button(
    ui: &mut egui::Ui,
    selected: bool,
    badge: bool,
    label: &str,
    circle_color: Color32,
    texture: Option<&TextureHandle>,
    tooltip: &str,
) -> Response {
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(48.0), Sense::click());
    let bg = if selected || response.hovered() {
        theme::SELECTED
    } else {
        theme::RAIL
    };
    ui.painter().rect_filled(rect, 24.0, bg);

    match texture {
        Some(texture) => {
            let image_rect = egui::Rect::from_center_size(rect.center(), Vec2::splat(40.0));
            ui.painter().image(
                texture.id(),
                image_rect,
                egui::Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                Color32::WHITE,
            );
        }
        None => {
            ui.painter().circle_filled(rect.center(), 20.0, circle_color);
            ui.painter().text(
                rect.center(),
                Align2::CENTER_CENTER,
                label,
                FontId::proportional(17.0),
                theme::WHITE,
            );
        }
    }

    if badge {
        ui.painter()
            .circle_filled(pos2(rect.left() + 2.0, rect.center().y), 3.0, theme::WHITE);
    }
    if tooltip.is_empty() {
        response
    } else {
        response.on_hover_text(tooltip)
    }
}
