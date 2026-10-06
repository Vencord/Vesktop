//! Central chat view: channel header, message list and compose box.

use std::collections::HashMap;

use egui::{FontId, Label, LayoutJob, RichText, ScrollArea, Sense, TextFormat, Vec2};

use crate::app::{ChannelRef, VesktopApp};
use crate::markup::{self, Style};
use crate::model::User;
use crate::theme;
use crate::ui::{draw_texture, initial_circle};
use crate::util;

pub fn paint(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let Some(channel_id) = app.selected_channel.clone() else {
        ui.centered_and_justified(|ui| {
            ui.vertical_centered(|ui| {
                ui.label(
                    RichText::new("Nenhuma conversa selecionada")
                        .size(20.0)
                        .strong()
                        .color(theme::MUTED),
                );
                ui.label(RichText::new("Escolha um servidor ou uma conversa à esquerda.").color(theme::MUTED));
            });
        });
        return;
    };

    let name = app.channel_name(&channel_id);
    let topic = app.channel_topic(&channel_id);
    let prefix = if matches!(app.channel_index.get(&channel_id), Some(ChannelRef::Dm)) {
        "@"
    } else {
        "#"
    };

    ui.horizontal(|ui| {
        ui.add_space(14.0);
        ui.label(
            RichText::new(format!("{prefix} {name}"))
                .strong()
                .size(17.0)
                .color(theme::TEXT),
        );
        if let Some(topic) = topic {
            ui.separator();
            ui.label(RichText::new(topic).small().color(theme::MUTED));
        }
    });
    ui.separator();

    let channel_names = app.channel_names();
    let mut load_older = false;

    ScrollArea::vertical()
        .auto_shrink(false)
        .stick_to_bottom(true)
        .show(ui, |ui| {
            ui.add_space(8.0);
            if app.has_more.get(&channel_id).copied().unwrap_or(false) {
                ui.vertical_centered(|ui| {
                    if app.loading_channels.contains(&channel_id) {
                        ui.label(RichText::new("Carregando…").small().color(theme::MUTED));
                    } else if ui.button("Carregar mensagens anteriores").clicked() {
                        load_older = true;
                    }
                });
                ui.add_space(8.0);
            }

            let users = &app.user_cache;
            if let Some(list) = app.messages.get(&channel_id) {
                if list.is_empty() {
                    ui.vertical_centered(|ui| {
                        ui.add_space(24.0);
                        ui.label(
                            RichText::new("Nenhuma mensagem por aqui ainda.").color(theme::MUTED),
                        );
                    });
                }
                for message in list.iter() {
                    ui.horizontal(|ui| {
                        ui.add_space(14.0);
                        let author_name = message.author.display_name();
                        let avatar_url = util::user_avatar_url(&message.author);
                        match app.images.get(ui.ctx(), &app.handle, &avatar_url) {
                            Some(texture) => draw_texture(ui, &texture, Vec2::splat(38.0)),
                            None => initial_circle(ui, 38.0, author_name, util::name_color(author_name)),
                        }
                        ui.add_space(8.0);
                        ui.vertical(|ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(author_name)
                                        .strong()
                                        .size(14.5)
                                        .color(util::name_color(author_name)),
                                );
                                ui.label(
                                    RichText::new(util::message_time(&message.timestamp))
                                        .small()
                                        .color(theme::MUTED),
                                );
                                if message.edited_timestamp.is_some() {
                                    ui.label(RichText::new("(editada)").small().color(theme::MUTED));
                                }
                            });
                            if !message.content.is_empty() {
                                let job = content_job(&message.content, users, &channel_names);
                                ui.add(Label::new(job));
                            }
                            for attachment in &message.attachments {
                                ui.label(
                                    RichText::new(format!(
                                        "📎 {} ({})",
                                        attachment.filename,
                                        util::human_size(attachment.size)
                                    ))
                                    .small()
                                    .color(theme::MUTED),
                                );
                            }
                            for embed in &message.embeds {
                                if embed.title.is_none() && embed.description.is_none() {
                                    continue;
                                }
                                ui.horizontal(|ui| {
                                    let (bar, _) =
                                        ui.allocate_exact_size(Vec2::new(3.0, 30.0), Sense::hover());
                                    ui.painter().rect_filled(bar, 1.5, theme::BLURPLE);
                                    ui.vertical(|ui| {
                                        if let Some(title) = &embed.title {
                                            ui.label(RichText::new(title).strong().color(theme::TEXT));
                                        }
                                        if let Some(description) = &embed.description {
                                            ui.label(
                                                RichText::new(description)
                                                    .small()
                                                    .color(theme::MUTED),
                                            );
                                        }
                                    });
                                });
                            }
                        });
                    });
                    ui.add_space(2.0);
                }
            }
        });

    if load_older {
        app.load_older_messages();
    }

    ui.add_space(6.0);
    if let Some(error) = &app.compose_error {
        ui.label(RichText::new(error).small().color(theme::RED));
        ui.add_space(2.0);
    }
    ui.horizontal(|ui| {
        ui.add_space(14.0);
        let hint = if name.is_empty() {
            "Enviar uma mensagem".to_string()
        } else {
            format!("Conversar em {prefix}{name}")
        };
        let edit = TextEdit::singleline(&mut app.compose)
            .hint_text(hint)
            .desired_width(ui.available_width() - 90.0)
            .show(ui);
        let send_clicked = ui.button("Enviar").clicked();
        let pressed_enter = edit.response.lost_focus()
            && ui.ctx().input(|input| input.key_pressed(egui::Key::Enter));
        if send_clicked || pressed_enter {
            app.send_current_message();
        }
        ui.add_space(14.0);
    });
    ui.add_space(8.0);
}

/// Maps markup segments to a styled `LayoutJob`, resolving mention and
/// channel ids against the state the caller already gathered.
fn content_job(
    text: &str,
    users: &HashMap<String, User>,
    channels: &HashMap<String, String>,
) -> LayoutJob {
    let mut job = LayoutJob::default();
    let mut offset = 0usize;
    for segment in markup::tokenize(text) {
        let mut format = TextFormat {
            font_id: FontId::proportional(14.5),
            color: theme::TEXT,
            ..Default::default()
        };
        let resolved = match segment.style {
            Style::Normal => None,
            Style::Bold => {
                format.color = theme::WHITE;
                None
            }
            Style::Italic => {
                format.italics = true;
                None
            }
            Style::Code | Style::CodeBlock => {
                format.font_id = FontId::monospace(13.0);
                format.background = theme::INPUT;
                None
            }
            Style::Mention => {
                format.color = theme::WHITE;
                format.background = theme::BLURPLE.gamma_multiply(0.35);
                users
                    .get(segment.text.trim_start_matches('@'))
                    .map(|user| format!("@{}", user.display_name()))
            }
            Style::ChannelName => {
                format.color = theme::WHITE;
                format.background = theme::BLURPLE.gamma_multiply(0.35);
                channels
                    .get(segment.text.trim_start_matches('#'))
                    .map(|name| format!("#{name}"))
            }
            Style::Emoji => {
                format.color = theme::MUTED;
                None
            }
            Style::Link => {
                format.color = theme::BLURPLE;
                format.underline = egui::Stroke::new(1.0, theme::BLURPLE);
                None
            }
        };
        let text = resolved.unwrap_or(segment.text);
        job.append(&text, offset, format);
        offset += text.len();
    }
    job
}
