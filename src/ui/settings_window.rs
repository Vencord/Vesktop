//! Settings window: appearance, account and behavior toggles. Mirrors the
//! subset of Vesktop's Electron settings that a native client can honor.

use egui::RichText;

use crate::app::VesktopApp;
use crate::paths;
use crate::settings::Theme;
use crate::theme;

pub fn show(app: &mut VesktopApp, ctx: &egui::Context) {
    let mut open = app.settings_open;
    let mut logged_out = false;
    egui::Window::new(RichText::new("Configurações").strong())
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .show(ctx, |ui| {
            ui.heading("Aparência");
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.label("Tema:");
                if ui.radio(app.settings.theme == Theme::Dark, "Escuro").clicked() {
                    app.settings.theme = Theme::Dark;
                    app.settings.save();
                }
                if ui.radio(app.settings.theme == Theme::Light, "Claro").clicked() {
                    app.settings.theme = Theme::Light;
                    app.settings.save();
                }
            });
            ui.horizontal(|ui| {
                ui.label("Zoom:");
                let response = ui.add(
                    egui::Slider::new(&mut app.settings.zoom, 0.5..=2.0).step_by(0.05),
                );
                if response.changed() {
                    app.settings.save();
                }
            });

            ui.separator();
            ui.heading("Conta");
            if let Some(user) = &app.me {
                ui.label(format!("Conectado como {}", user.display_name()));
            }
            if ui
                .button("Sair (remover token deste dispositivo)")
                .clicked()
            {
                app.logout();
                logged_out = true;
            }

            ui.separator();
            ui.heading("Comportamento");
            let mut tray = app.settings.tray;
            ui.add_enabled(
                false,
                egui::Checkbox::new(&mut tray, "Minimizar para a bandeja (em breve)"),
            );
            let mut updates = app.settings.check_for_updates;
            if ui
                .add(egui::Checkbox::new(
                    &mut updates,
                    "Procurar atualizações automaticamente (em breve)",
                ))
                .changed()
            {
                app.settings.check_for_updates = updates;
                app.settings.save();
            }

            ui.separator();
            ui.label(
                RichText::new(format!(
                    "Configurações salvas em {}",
                    paths::settings_file().display()
                ))
                .small()
                .color(theme::MUTED),
            );
        });

    if (!open || logged_out) && app.settings_open {
        app.settings_open = false;
        app.settings.save();
    }
}
