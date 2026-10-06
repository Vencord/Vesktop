//! Token login screen. A native client can't render Discord's interactive
//! login flow (it's a browser page with captcha), so accounts are linked by
//! token instead — the same approach every native third-party client takes.

use egui::RichText;

use crate::app::{ConnState, VesktopApp};
use crate::theme;

pub fn show(app: &mut VesktopApp, ctx: &egui::Context) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
        ui.vertical_centered(|ui| {
            ui.add_space(64.0);
            ui.label(RichText::new("Vesktop").size(44.0).strong().color(theme::TEXT));
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
            ui.collapsing(RichText::new("Como obter o token").color(theme::MUTED), |ui| {
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
            });
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
}
