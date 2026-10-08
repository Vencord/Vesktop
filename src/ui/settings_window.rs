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
                if ui
                    .radio(app.settings.theme == Theme::Dark, "Escuro")
                    .clicked()
                {
                    app.settings.theme = Theme::Dark;
                    app.settings.save();
                }
                if ui
                    .radio(app.settings.theme == Theme::Light, "Claro")
                    .clicked()
                {
                    app.settings.theme = Theme::Light;
                    app.settings.save();
                }
            });
            ui.horizontal(|ui| {
                ui.label("Zoom:");
                let response =
                    ui.add(egui::Slider::new(&mut app.settings.zoom, 0.5..=2.0).step_by(0.05));
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
            ui.heading("Voz");
            voice_settings(app, ui);

            ui.separator();
            ui.heading("Compartilhamento de tela");
            screen_share_settings(app, ui);

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

/// Device pickers, input sensitivity and noise suppression. Device changes
/// restart the audio streams live when in a call (docs/VOICE.md, phase 4).
fn voice_settings(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let outputs = crate::backend::audio::list_devices(true);
    let inputs = crate::backend::audio::list_devices(false);
    let mut changed = false;

    // Pickers show the desktop's friendly names; the settings store the
    // sound server's device name.
    let describe = |devices: &[(String, String)], wanted: &Option<String>| -> String {
        match wanted {
            None => "Padrão do sistema".to_string(),
            Some(name) => devices
                .iter()
                .find(|(pulse_name, _)| pulse_name == name)
                .map(|(_, description)| description.clone())
                .unwrap_or_else(|| name.clone()),
        }
    };

    ui.horizontal(|ui| {
        ui.label("Saída:");
        egui::ComboBox::from_id_salt("voz_saida")
            .selected_text(describe(&outputs, &app.settings.output_device))
            .show_ui(ui, |ui| {
                if ui
                    .selectable_label(app.settings.output_device.is_none(), "Padrão do sistema")
                    .clicked()
                {
                    app.settings.output_device = None;
                    changed = true;
                }
                for (name, description) in &outputs {
                    let selected = app.settings.output_device.as_deref() == Some(name);
                    if ui.selectable_label(selected, description).clicked() {
                        app.settings.output_device = Some(name.clone());
                        changed = true;
                    }
                }
            });
    });

    ui.horizontal(|ui| {
        ui.label("Entrada:");
        egui::ComboBox::from_id_salt("voz_entrada")
            .selected_text(describe(&inputs, &app.settings.input_device))
            .show_ui(ui, |ui| {
                if ui
                    .selectable_label(app.settings.input_device.is_none(), "Padrão do sistema")
                    .clicked()
                {
                    app.settings.input_device = None;
                    changed = true;
                }
                for (name, description) in &inputs {
                    let selected = app.settings.input_device.as_deref() == Some(name);
                    if ui.selectable_label(selected, description).clicked() {
                        app.settings.input_device = Some(name.clone());
                        changed = true;
                    }
                }
            });
    });

    ui.horizontal(|ui| {
        ui.label("Sensibilidade do microfone:");
        let slider = ui
            .add(
                egui::Slider::new(&mut app.settings.input_sensitivity, 0..=100)
                    .text("0 = sempre aberto"),
            )
            .changed();
        if slider {
            changed = true;
        }
    });
    if ui
        .checkbox(&mut app.settings.noise_suppression, "Supressão de ruído (RNNoise)")
        .changed()
    {
        changed = true;
    }

    if changed {
        app.settings.save();
        app.push_voice_audio_config();
    }
}

/// FockyTV as the share backend; off falls back to Discord's Go Live.
fn screen_share_settings(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let mut changed = ui
        .checkbox(
            &mut app.settings.fockytv_share,
            "Usar backend de compartilhamento do FockyTV",
        )
        .on_hover_text("Desligado: Go Live do Discord (experimental)")
        .changed();
    ui.add_enabled_ui(app.settings.fockytv_share, |ui| {
        ui.horizontal(|ui| {
            ui.label("Servidor:");
            changed |= ui
                .text_edit_singleline(&mut app.settings.fockytv_url)
                .changed();
        });
        ui.horizontal(|ui| {
            ui.label("Taxa de quadros:");
            for fps in [60, 30, 15] {
                if ui
                    .radio(app.settings.fockytv_fps == fps, format!("{fps} fps"))
                    .clicked()
                {
                    app.settings.fockytv_fps = fps;
                    changed = true;
                }
            }
        })
        .response
        .on_hover_text("Vale para a próxima transmissão");
        ui.horizontal(|ui| {
            ui.label("Nick:");
            let username = app.me.as_ref().map(|me| me.username.clone()).unwrap_or_default();
            let mut nick = app.settings.fockytv_nick.clone().unwrap_or_default();
            if ui
                .add(egui::TextEdit::singleline(&mut nick).hint_text(username))
                .on_hover_text("A chave da transmissão no FockyTV; vazio = seu usuário do Discord")
                .changed()
            {
                app.settings.fockytv_nick = Some(nick).filter(|nick| !nick.trim().is_empty());
                changed = true;
            }
        });
    });
    if changed {
        app.settings.save();
    }
}
