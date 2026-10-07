//! Login screen. A native client can't render Discord's email/password page
//! (it's a browser page with captcha), so accounts are linked by scanning a
//! QR code with the phone app, or by pasting a token.

use egui::RichText;

use crate::app::{ConnState, QrState, VesktopApp};
use crate::theme;

pub fn show(app: &mut VesktopApp, root: &mut egui::Ui) {
    if app.settings.token.is_none() && matches!(app.qr, QrState::Idle) {
        app.start_qr();
    }
    egui::CentralPanel::default().show(root, |ui| {
        ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(32.0);
                ui.label(
                    RichText::new("Vesktop")
                        .size(44.0)
                        .strong()
                        .color(theme::TEXT),
                );
                ui.add_space(4.0);
                ui.label(RichText::new("Cliente Discord nativo — Rust + egui").color(theme::MUTED));
                ui.add_space(32.0);

                match &app.conn {
                    ConnState::LoginError(message) => {
                        ui.label(RichText::new(message).color(theme::RED));
                        ui.add_space(8.0);
                    }
                    ConnState::Connecting => {
                        ui.label(RichText::new("Conectando…").color(theme::MUTED));
                        ui.add_space(8.0);
                    }
                    ConnState::Disconnected(_) if app.settings.token.is_some() => {
                        ui.label(RichText::new("Reconectando…").color(theme::MUTED));
                        ui.add_space(8.0);
                    }
                    _ => {}
                }

                qr_section(app, ui);
                ui.add_space(16.0);
                ui.label(
                    RichText::new("ou entre com um token")
                        .small()
                        .color(theme::MUTED),
                );
                ui.add_space(8.0);

                let width = 340.0;
                let edit = egui::TextEdit::singleline(&mut app.login_token)
                    .password(true)
                    .hint_text("Token do Discord")
                    .desired_width(width)
                    .show(ui);
                ui.add_space(8.0);
                let pressed_enter = edit.response.lost_focus()
                    && ui.input(|input| input.key_pressed(egui::Key::Enter));
                let clicked = ui
                    .add_sized(
                        [width, 36.0],
                        egui::Button::new(RichText::new("Entrar").color(theme::WHITE)),
                    )
                    .clicked();
                if clicked || pressed_enter {
                    app.connect_from_login();
                }

                ui.add_space(24.0);
                ui.collapsing(
                    RichText::new("Como obter o token").color(theme::MUTED),
                    |ui| {
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
                ui.add_space(12.0);
                ui.label(
                    RichText::new(
                        "Clientes de terceiros podem violar os Termos de Serviço do Discord. \
                     Use por sua conta e risco.",
                    )
                    .small()
                    .color(theme::MUTED),
                );
            });
        });
    });
}

const QR_SIZE: f32 = 200.0;

fn qr_section(app: &mut VesktopApp, ui: &mut egui::Ui) {
    match app.qr.clone() {
        QrState::Idle | QrState::Loading => {
            ui.add_sized([QR_SIZE, QR_SIZE], egui::Spinner::new());
        }
        QrState::Code(url) => {
            paint_qr(ui, &url);
            ui.add_space(8.0);
            ui.label(RichText::new("Escaneie com o app do Discord no celular").color(theme::TEXT));
        }
        QrState::Scanned(username) => {
            ui.add_sized([QR_SIZE, QR_SIZE], egui::Spinner::new());
            ui.add_space(8.0);
            ui.label(
                RichText::new(format!("Confirme o login de {username} no celular"))
                    .color(theme::TEXT),
            );
        }
        QrState::Failed(reason) => {
            ui.label(RichText::new(format!("QR code: {reason}")).color(theme::RED));
            ui.add_space(8.0);
            if ui.button("Gerar novo QR code").clicked() {
                app.start_qr();
            }
        }
    }
}

/// Paints the code as plain rects, with the 4-module quiet zone scanners expect.
fn paint_qr(ui: &mut egui::Ui, data: &str) {
    let Ok(code) = qrcode::QrCode::new(data.as_bytes()) else {
        return;
    };
    let width = code.width();
    let cell = QR_SIZE / (width + 8) as f32;
    let (rect, _) = ui.allocate_exact_size(egui::vec2(QR_SIZE, QR_SIZE), egui::Sense::hover());
    let painter = ui.painter();
    painter.rect_filled(rect, 8.0, theme::WHITE);
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
}
