//! Login screen. A native client can't render Discord's email/password page
//! (it's a browser page with captcha), so accounts are linked by scanning a
//! QR code with the phone app, or by pasting a token as an advanced option.
//! The layout follows Discord's own login page: a two-column card that
//! stacks on narrow windows (docs/UI.md §2).

use egui::{Align2, RichText, Sense, Vec2};

use crate::app::{ConnState, QrState, VesktopApp};
use crate::theme;
use crate::ui::round_avatar;
use crate::util;

const COLUMN: f32 = 330.0;
const GAP: f32 = 48.0;
const QR: f32 = 180.0;

pub fn show(app: &mut VesktopApp, root: &mut egui::Ui) {
    if app.settings.token.is_none() && matches!(app.qr, QrState::Idle) {
        app.start_qr();
    }
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE)
        .show(root, |ui| {
            ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
            ui.centered_and_justified(|ui| {
                ui.vertical_centered(|ui| {
                    ui.add_space(24.0);
                    let card_width = (COLUMN * 2.0 + GAP + 64.0).min(ui.available_width() - 24.0);
                    let narrow = card_width < COLUMN * 2.0 + GAP + 32.0;
                    egui::Frame::default()
                        .fill(theme::CHAT)
                        .corner_radius(theme::RADIUS_LG)
                        .inner_margin(32.0)
                        .show(ui, |ui| {
                            ui.set_width(card_width - 64.0);
                            if narrow {
                                welcome_column(app, ui);
                                ui.add_space(20.0);
                                ui.separator();
                                ui.add_space(20.0);
                                qr_column(app, ui);
                            } else {
                                ui.horizontal(|ui| {
                                    ui.allocate_ui(Vec2::new(COLUMN, 240.0), |ui| {
                                        welcome_column(app, ui);
                                    });
                                    // Discord's vertical divider.
                                    let (rect, _) = ui
                                        .allocate_exact_size(Vec2::new(1.0, 200.0), Sense::hover());
                                    ui.painter().rect_filled(
                                        rect,
                                        0.0,
                                        ui.visuals().widgets.noninteractive.bg_stroke.color,
                                    );
                                    ui.add_space(GAP - 2.0);
                                    ui.allocate_ui(Vec2::new(COLUMN, 240.0), |ui| {
                                        qr_column(app, ui);
                                    });
                                });
                            }
                        });
                    ui.add_space(12.0);
                    ui.label(
                        RichText::new(
                            "Clientes de terceiros podem violar os Termos de Serviço do \
                             Discord. Use por sua conta e risco.",
                        )
                        .small()
                        .color(theme::MUTED),
                    );
                });
            });
        });
}

fn welcome_column(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.vertical_centered(|ui| {
        ui.label(
            RichText::new("Boas-vindas de volta!")
                .size(24.0)
                .strong()
                .color(theme::TEXT),
        );
        ui.label(
            RichText::new("Contente em te ver de novo!")
                .small()
                .color(theme::MUTED),
        );
        ui.add_space(8.0);
        if let ConnState::LoginError(message) = &app.conn {
            ui.label(RichText::new(message).small().color(theme::RED));
            ui.add_space(8.0);
        }

        ui.collapsing(
            RichText::new("Entrar com token").color(theme::MUTED),
            |ui| {
                ui.set_width(COLUMN - 48.0);
                let edit = egui::TextEdit::singleline(&mut app.login_token)
                    .password(true)
                    .hint_text("Token do Discord")
                    .desired_width(ui.available_width())
                    .show(ui);
                ui.add_space(8.0);
                let pressed_enter = edit.response.lost_focus()
                    && ui.input(|input| input.key_pressed(egui::Key::Enter));
                let clicked = ui
                    .add_sized(
                        [ui.available_width(), 36.0],
                        egui::Button::new(RichText::new("Entrar").color(theme::WHITE)),
                    )
                    .clicked();
                if clicked || pressed_enter {
                    app.connect_from_login();
                }
                ui.add_space(8.0);
                ui.label(
                    RichText::new(
                        "1. Abra discord.com no navegador e entre na sua conta;\n\
                     2. Aperte Ctrl+Shift+I para abrir o DevTools;\n\
                     3. Na aba Console, rode: localStorage.token\n\
                     4. Copie o valor entre aspas e cole acima.",
                    )
                    .small()
                    .color(theme::MUTED),
                );
            },
        );
    });
}

fn qr_column(app: &mut VesktopApp, ui: &mut egui::Ui) {
    ui.vertical_centered(|ui| {
        ui.label(
            RichText::new("Entrar com código QR")
                .size(20.0)
                .strong()
                .color(theme::TEXT),
        );
        ui.add_space(10.0);
        qr_section(app, ui);
        ui.add_space(10.0);
        ui.label(
            RichText::new("Escaneie com o app do Discord no celular")
                .small()
                .color(theme::MUTED),
        );
    });
}

fn qr_section(app: &mut VesktopApp, ui: &mut egui::Ui) {
    match app.qr.clone() {
        QrState::Idle | QrState::Loading => {
            ui.add_sized([QR, QR], egui::Spinner::new().size(40.0));
        }
        QrState::Code(url) => {
            paint_qr(ui, &url);
        }
        QrState::Scanned {
            username,
            user_id,
            avatar,
        } => {
            ui.add_sized([QR, QR], egui::Spinner::new().size(40.0));
            ui.add_space(8.0);
            // Avatar and name straight from the pending ticket.
            let texture = avatar.as_deref().and_then(|hash| {
                let url =
                    format!("https://cdn.discordapp.com/avatars/{user_id}/{hash}.png?size=64");
                app.images.get(ui.ctx(), &app.handle, &url)
            });
            round_avatar(
                ui,
                texture.as_ref(),
                40.0,
                &username,
                util::name_color(&username),
            );
            ui.add_space(4.0);
            ui.label(RichText::new("Confirme no seu celular").color(theme::TEXT));
            ui.label(RichText::new(&username).strong().color(theme::TEXT));
            ui.add_space(4.0);
            if ui
                .add(egui::Button::new(
                    RichText::new("Começar de novo").color(theme::BLURPLE),
                ))
                .clicked()
            {
                app.start_qr();
            }
        }
        QrState::Failed(reason) => {
            ui.label(RichText::new(reason).small().color(theme::RED));
            ui.add_space(8.0);
            if ui.button("Gerar novo QR code").clicked() {
                app.start_qr();
            }
        }
    }
}

/// Paints the code as plain rects, with the 4-module quiet zone scanners
/// expect, and Vesktop's mark in the middle. `EcLevel::H` leaves enough
/// redundancy for the covered modules to still scan.
fn paint_qr(ui: &mut egui::Ui, data: &str) {
    let Ok(code) = qrcode::QrCode::with_error_correction_level(data.as_bytes(), qrcode::EcLevel::H)
    else {
        return;
    };
    let width = code.width();
    let cell = QR / (width + 8) as f32;
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(QR), Sense::hover());
    let painter = ui.painter();
    painter.rect_filled(rect, theme::RADIUS_MD, theme::WHITE);
    for (i, color) in code.to_colors().into_iter().enumerate() {
        if color == qrcode::Color::Dark {
            let x = (i % width + 4) as f32 * cell;
            let y = (i / width + 4) as f32 * cell;
            painter.rect_filled(
                egui::Rect::from_min_size(rect.min + egui::vec2(x, y), egui::vec2(cell, cell)),
                0.0,
                egui::Color32::BLACK,
            );
        }
    }
    // Vesktop's mark, on a white plate so the modules stay light there.
    let plate = QR * 0.22;
    let icon = egui::Rect::from_center_size(rect.center(), Vec2::splat(plate));
    painter.rect_filled(icon, 6.0, theme::WHITE);
    painter.text(
        icon.center(),
        Align2::CENTER_CENTER,
        "V",
        egui::FontId::proportional(plate * 0.7),
        egui::Color32::BLACK,
    );
}
