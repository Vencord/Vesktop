//! Startup splash, shown inside the main window while a saved token has no
//! READY yet: the animated Vesktop logo, "Carregando Vesktop…" and a status
//! line that follows the real connection steps. Covers Electron's slow
//! startup without a separate window (docs/UI.md §1).

use egui::{Image, RichText, Vec2};

use crate::app::{ConnState, VesktopApp};
use crate::theme;

const SPLASH_WEBP: &[u8] = include_bytes!("../../static/splash.webp");
const LOGO: f32 = 128.0;

pub fn show(app: &mut VesktopApp, root: &mut egui::Ui) {
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE)
        .show(root, |ui| {
            ui.painter().rect_filled(ui.max_rect(), 0.0, theme::RAIL);
            ui.centered_and_justified(|ui| {
                ui.vertical_centered(|ui| {
                    ui.add(
                        Image::from_bytes("cache://vesktop-splash.webp", SPLASH_WEBP)
                            .fit_to_exact_size(Vec2::splat(LOGO)),
                    );
                    ui.add_space(18.0);
                    ui.label(
                        RichText::new("Carregando Vesktop…")
                            .size(16.0)
                            .strong()
                            .color(theme::TEXT),
                    );
                    ui.add_space(6.0);
                    status(app, ui);
                });
            });
        });
}

fn status(app: &mut VesktopApp, ui: &mut egui::Ui) {
    match app.conn.clone() {
        ConnState::Connecting => {
            ui.label(
                RichText::new("Conectando ao Discord…")
                    .small()
                    .color(theme::MUTED),
            );
        }
        ConnState::Connected => {
            ui.label(
                RichText::new("Carregando servidores…")
                    .small()
                    .color(theme::MUTED),
            );
        }
        ConnState::Disconnected(reason, retry_in) => {
            let seconds = retry_in
                .zip(app.disconnected_at)
                .map(|(total, since)| {
                    let elapsed = since.elapsed().as_secs();
                    total.saturating_sub(elapsed)
                })
                .or(retry_in);
            let label = match seconds {
                Some(remaining) => format!("Reconectando em {remaining}s… ({reason})"),
                None => format!("Reconectando… ({reason})"),
            };
            ui.label(RichText::new(label).small().color(theme::MUTED));
        }
        ConnState::LoginError(message) => {
            ui.label(RichText::new(message).small().color(theme::RED));
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.button("Tentar de novo").clicked() {
                    app.retry_connection();
                }
                if ui.button("Sair da conta").clicked() {
                    app.logout();
                }
            });
        }
    }
}
