//! Discord-flavored egui palette, applied through `egui::Visuals` so every
//! standard widget picks it up without custom frames.

use crate::settings::Theme;
use egui::Color32;

pub const RAIL: Color32 = Color32::from_rgb(0x1e, 0x1f, 0x22);
pub const SIDEBAR: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x31);
pub const CHAT: Color32 = Color32::from_rgb(0x31, 0x33, 0x38);
pub const INPUT: Color32 = Color32::from_rgb(0x38, 0x3a, 0x40);
pub const TEXT: Color32 = Color32::from_rgb(0xdb, 0xde, 0xe1);
pub const MUTED: Color32 = Color32::from_rgb(0x94, 0x9b, 0xa4);
pub const BLURPLE: Color32 = Color32::from_rgb(0x58, 0x65, 0xf2);
pub const GREEN: Color32 = Color32::from_rgb(0x23, 0xa5, 0x59);
pub const RED: Color32 = Color32::from_rgb(0xf2, 0x3f, 0x43);
pub const WHITE: Color32 = Color32::from_rgb(0xff, 0xff, 0xff);
pub const HOVER: Color32 = Color32::from_rgb(0x39, 0x3c, 0x42);
pub const SELECTED: Color32 = Color32::from_rgb(0x40, 0x42, 0x49);

pub fn apply(ctx: &egui::Context, theme: Theme) {
    let mut visuals = match theme {
        Theme::Dark => egui::Visuals::dark(),
        Theme::Light => egui::Visuals::light(),
    };
    if theme == Theme::Dark {
        visuals.panel_fill = SIDEBAR;
        visuals.window_fill = CHAT;
        visuals.extreme_bg_color = INPUT;
        visuals.faint_bg_color = HOVER;
        visuals.widgets.hovered.bg_fill = HOVER;
        visuals.widgets.active.bg_fill = SELECTED;
        visuals.selection.bg_fill = BLURPLE;
        visuals.link_color = BLURPLE;
    }
    ctx.style_mut(move |style| style.visuals = visuals);
}
