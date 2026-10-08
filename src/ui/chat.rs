//! Central chat view: channel header, Discord-style timeline (date
//! separators, grouped messages, replies, new-messages divider) and the
//! multiline compose box.

use std::collections::HashMap;

use chrono::DateTime;
use egui::text::LayoutJob;
use egui::{
    Align, Align2, Color32, FontId, Image, Label, RichText, ScrollArea, Sense, Shape, TextEdit,
    TextFormat, Vec2, pos2,
};

use crate::app::{ChannelRef, VesktopApp};
use crate::markup::{self, Style};
use crate::model::{Message, User};
use crate::theme;
use crate::ui::channel_sidebar::draw_search_icon;
use crate::ui::round_avatar;
use crate::util;

/// Left margin, avatar width and the content indent they add up to.
const AVATAR: f32 = 40.0;
const LEFT: f32 = 16.0;
const GAP: f32 = 12.0;
const CONTENT: f32 = LEFT + AVATAR + GAP;
/// Column where a reply's mini avatar hangs.
const REPLY_AVATAR_X: f32 = LEFT + AVATAR - 8.0;
/// Inline images never grow beyond this.
const INLINE_MAX: f32 = 420.0;
const GROUPING_MINUTES: i64 = 7;

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
                ui.label(
                    RichText::new("Escolha um servidor ou uma conversa à esquerda.")
                        .color(theme::MUTED),
                );
            });
        });
        return;
    };

    let name = app.channel_name(&channel_id);
    let topic = app.channel_topic(&channel_id);
    let is_dm = matches!(app.channel_index.get(&channel_id), Some(ChannelRef::Dm));
    let prefix = if is_dm { "@" } else { "#" };

    // Header, Discord-style: avatar plus name on a DM (with presence), the
    // channel name elsewhere, and the search icon on the right edge.
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        ui.add_space(14.0);
        if is_dm {
            let partner = app
                .dm_channels
                .iter()
                .find(|channel| channel.id == channel_id)
                .and_then(|channel| channel.recipients.first())
                .cloned();
            if let Some(partner) = partner {
                let url = util::user_avatar_url(&partner);
                let texture = app.images.get(ui.ctx(), &app.handle, &url);
                let (avatar_rect, _) = ui.allocate_exact_size(Vec2::splat(24.0), Sense::hover());
                match texture {
                    Some(texture) => {
                        ui.painter().image(
                            texture.id(),
                            avatar_rect,
                            egui::Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                            egui::Color32::WHITE,
                        );
                    }
                    None => {
                        ui.painter().circle_filled(
                            avatar_rect.center(),
                            12.0,
                            util::name_color(partner.display_name()),
                        );
                    }
                }
                if let Some(status) = app.presence.get(&partner.id) {
                    let dot = pos2(avatar_rect.min.x + 20.0, avatar_rect.min.y + 20.0);
                    let color = match status.as_str() {
                        "online" => theme::GREEN,
                        "idle" => theme::YELLOW,
                        "dnd" => theme::RED,
                        _ => theme::MUTED,
                    };
                    ui.painter().circle_filled(dot, 4.5, theme::CHAT);
                    ui.painter().circle_filled(dot, 3.2, color);
                }
                ui.add_space(8.0);
            }
            ui.label(RichText::new(&name).strong().size(16.0).color(theme::TEXT));
            if let Some(partner_status) = app
                .dm_channels
                .iter()
                .find(|channel| channel.id == channel_id)
                .and_then(|channel| channel.recipients.first())
                .and_then(|partner| app.presence.get(&partner.id))
            {
                ui.add_space(8.0);
                let (dot, label) = match partner_status.as_str() {
                    "online" => (theme::GREEN, "Online"),
                    "idle" => (theme::YELLOW, "Ausente"),
                    "dnd" => (theme::RED, "Não perturbe"),
                    _ => (theme::MUTED, "Offline"),
                };
                ui.label(RichText::new("●").size(10.0).color(dot));
                ui.add_space(3.0);
                ui.label(RichText::new(label).small().color(theme::MUTED));
            }
        } else {
            ui.add_space(2.0);
            ui.label(
                RichText::new(format!("{prefix} {name}"))
                    .strong()
                    .size(16.0)
                    .color(theme::TEXT),
            );
            if let Some(topic) = &topic {
                ui.add_space(10.0);
                ui.label(RichText::new(topic).small().color(theme::MUTED));
            }
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.add_space(14.0);
            let (rect, response) = ui.allocate_exact_size(Vec2::splat(22.0), Sense::hover());
            if response.hovered() {
                ui.painter().rect_filled(rect, 4.0, theme::HOVER);
            }
            draw_search_icon(ui.painter(), rect.center(), theme::TEXT);
            let _ = response.on_hover_text("Buscar (em breve)");
        });
    });
    ui.separator();

    // The compose box goes in first as a bottom panel: the message list's
    // ScrollArea takes all remaining height, so anything after it is clipped.
    let typers = app.typers(&channel_id);
    egui::Panel::bottom("compose")
        .frame(egui::Frame::NONE)
        .show(ui, |ui| {
            ui.add_space(6.0);
            if !typers.is_empty() {
                ui.horizontal(|ui| {
                    ui.add_space(18.0);
                    ui.label(
                        RichText::new(typing_label(&typers))
                            .small()
                            .color(theme::MUTED),
                    );
                });
                ui.ctx()
                    .request_repaint_after(std::time::Duration::from_secs(1));
            }
            if let Some(error) = &app.compose_error {
                ui.horizontal(|ui| {
                    ui.add_space(18.0);
                    ui.label(RichText::new(error).small().color(theme::RED));
                });
                ui.add_space(2.0);
            }
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                ui.add_space(14.0);
                let width = ui.available_width();
                let hint = if name.is_empty() {
                    "Enviar uma mensagem".to_string()
                } else {
                    format!("Conversar em {prefix}{name}")
                };
                let mut send = false;
                egui::Frame::default()
                    .fill(theme::INPUT)
                    .corner_radius(theme::RADIUS_MD)
                    .inner_margin(egui::Margin::symmetric(10, 8))
                    .show(ui, |ui| {
                        ui.set_width(width - 28.0);
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing = Vec2::ZERO;
                            // Attachment plus, inside the box like Discord's.
                            let (plus_rect, plus) =
                                ui.allocate_exact_size(Vec2::splat(24.0), Sense::click());
                            if plus.hovered() {
                                ui.painter().rect_filled(plus_rect, 4.0, theme::HOVER);
                            }
                            let pc = plus_rect.center();
                            let stroke = egui::Stroke::new(1.8, theme::TEXT);
                            ui.painter().line_segment(
                                [pos2(pc.x - 6.0, pc.y), pos2(pc.x + 6.0, pc.y)],
                                stroke,
                            );
                            ui.painter().line_segment(
                                [pos2(pc.x, pc.y - 6.0), pos2(pc.x, pc.y + 6.0)],
                                stroke,
                            );
                            let _ = plus.on_hover_text("Enviar arquivo (em breve)");
                            ui.add_space(6.0);

                            let edit = TextEdit::multiline(&mut app.compose)
                                .hint_text(hint)
                                .desired_rows(1)
                                .desired_width(ui.available_width() - 76.0)
                                .frame(egui::Frame::NONE)
                                .show(ui);
                            // Enter sends, Shift+Enter breaks the line.
                            let enter = ui.ctx().input(|input| {
                                input.key_pressed(egui::Key::Enter) && !input.modifiers.shift
                            });
                            if edit.response.has_focus() && enter {
                                send = true;
                            }

                            // Right cluster: GIF and emoji, Discord-style.
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    ui.spacing_mut().item_spacing = Vec2::ZERO;
                                    let (smile_rect, smile) =
                                        ui.allocate_exact_size(Vec2::splat(24.0), Sense::click());
                                    if smile.hovered() {
                                        ui.painter().rect_filled(smile_rect, 4.0, theme::HOVER);
                                    }
                                    draw_smiley(ui.painter(), smile_rect.center(), theme::TEXT);
                                    let _ = smile.on_hover_text("Emoji (em breve)");
                                    let (gif_rect, gif) = ui
                                        .allocate_exact_size(Vec2::new(30.0, 24.0), Sense::click());
                                    if gif.hovered() {
                                        ui.painter().rect_filled(gif_rect, 4.0, theme::HOVER);
                                    }
                                    ui.painter().text(
                                        gif_rect.center(),
                                        egui::Align2::CENTER_CENTER,
                                        "GIF",
                                        egui::FontId::proportional(12.0),
                                        theme::TEXT,
                                    );
                                    let _ = gif.on_hover_text("GIF (em breve)");
                                },
                            );
                        });
                    });
                // Typing signal, throttled inside note_typing.
                if app.compose != app.last_compose {
                    app.last_compose = app.compose.clone();
                    app.note_typing();
                }
                if send {
                    app.send_current_message();
                }
                ui.add_space(14.0);
            });
            ui.add_space(10.0);
        });

    let channel_names = app.channel_names();
    let mut load_older = false;
    let first_unread = app.first_unread.get(&channel_id).cloned();

    let scroll = ScrollArea::vertical()
        .auto_shrink(false)
        .stick_to_bottom(true)
        .show(ui, |ui| {
            ui.add_space(8.0);

            let has_more = app.has_more.get(&channel_id).copied().unwrap_or(false);
            if has_more {
                ui.vertical_centered(|ui| {
                    if app.loading_channels.contains(&channel_id) {
                        ui.label(RichText::new("Carregando…").small().color(theme::MUTED));
                    } else if ui.button("Carregar mensagens anteriores").clicked() {
                        load_older = true;
                    }
                });
                ui.add_space(8.0);
            } else {
                conversation_start(app, ui, &channel_id);
            }

            // Cloned so message painting can take `&mut app` (image cache).
            let list = app.messages.get(&channel_id).cloned().unwrap_or_default();
            for (index, message) in list.iter().enumerate() {
                let previous = if index > 0 {
                    Some(&list[index - 1])
                } else {
                    None
                };
                let day_change = previous
                    .map(|prev| {
                        util::local_day(&prev.timestamp) != util::local_day(&message.timestamp)
                    })
                    .unwrap_or(true);
                let grouped = !day_change && previous.is_some_and(|prev| can_group(prev, message));

                if day_change && !message.timestamp.is_empty() {
                    date_separator(ui, &util::day_label_long(&message.timestamp));
                }
                if first_unread.as_deref() == Some(message.id.as_str()) {
                    new_messages_divider(ui);
                }
                // Discord breathes between message groups: a new author or a
                // reply opens a taller gap than a grouped continuation.
                if index > 0 && !grouped {
                    ui.add_space(12.0);
                } else if index > 0 {
                    ui.add_space(4.0);
                }
                paint_message(app, ui, message, grouped, &channel_names);
            }

            if app.jump_to_present {
                app.jump_to_present = false;
                ui.scroll_to_cursor(Some(Align::BOTTOM));
            }
        });

    let at_bottom =
        (scroll.state.offset.y + scroll.inner_rect.height()) >= scroll.content_size.y - 1.0;
    if at_bottom {
        if let Some(last) = app
            .messages
            .get(&channel_id)
            .and_then(|list| list.last())
            .map(|message| message.id.clone())
        {
            app.mark_channel_read(&channel_id, last);
        }
    } else {
        // "Ir para o presente", pinned above the compose box.
        egui::Area::new(egui::Id::new("jump_to_present"))
            .anchor(Align2::RIGHT_BOTTOM, [-24.0, -96.0])
            .order(egui::Order::Foreground)
            .show(ui.ctx(), |ui| {
                if ui
                    .button(RichText::new("Ir para o presente").color(theme::TEXT))
                    .on_hover_text("Pular para as mensagens mais recentes")
                    .clicked()
                {
                    app.jump_to_present = true;
                }
            });
    }

    if load_older {
        app.load_older_messages();
    }
}

/// Discord groups consecutive messages from the same author within 7
/// minutes, as long as the later one isn't a reply or a system message.
fn can_group(previous: &Message, message: &Message) -> bool {
    if message.message_reference.is_some() || message.is_system() {
        return false;
    }
    if previous.author.id != message.author.id {
        return false;
    }
    let gap = (|| {
        let start = DateTime::parse_from_rfc3339(&previous.timestamp).ok()?;
        let end = DateTime::parse_from_rfc3339(&message.timestamp).ok()?;
        Some(end.signed_duration_since(start))
    })();
    matches!(gap, Some(span) if span.num_minutes() < GROUPING_MINUTES)
}

fn paint_message(
    app: &mut VesktopApp,
    ui: &mut egui::Ui,
    message: &Message,
    grouped: bool,
    channel_names: &HashMap<String, String>,
) {
    let row_top = ui.cursor().top();
    let author_name = message.author.display_name();

    let mut reply_band: Option<egui::Rect> = None;
    ui.vertical(|ui| {
        if message.message_reference.is_some() {
            let top = ui.cursor().top();
            reply_excerpt(app, ui, message);
            let bottom = ui.cursor().top();
            reply_band = Some(egui::Rect::from_min_max(
                pos2(LEFT, top),
                pos2(ui.max_rect().right(), bottom),
            ));
        }

        if grouped {
            ui.horizontal(|ui| {
                ui.add_space(CONTENT);
                ui.vertical(|ui| {
                    paint_content(app, ui, message, channel_names);
                });
            });
        } else {
            ui.horizontal(|ui| {
                ui.add_space(LEFT);
                let avatar_url = util::user_avatar_url(&message.author);
                let texture = app.images.get(ui.ctx(), &app.handle, &avatar_url);
                round_avatar(
                    ui,
                    texture.as_ref(),
                    AVATAR,
                    author_name,
                    util::name_color(author_name),
                );
                ui.add_space(GAP);
                ui.vertical(|ui| {
                    // Author line with the timestamp pinned to the right
                    // edge, Discord-style.
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing = Vec2::ZERO;
                        ui.add(
                            egui::Label::new(
                                RichText::new(author_name)
                                    .strong()
                                    .size(14.5)
                                    .color(util::name_color(author_name)),
                            )
                            .truncate(),
                        );
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.add_space(10.0);
                            if message.edited_timestamp.is_some() {
                                ui.label(RichText::new("(editada)").small().color(theme::MUTED));
                            }
                            let (label, exact) = util::header_time(&message.timestamp);
                            if !label.is_empty() {
                                ui.label(RichText::new(label).small().color(theme::MUTED))
                                    .on_hover_text(exact);
                            }
                        });
                    });
                    paint_content(app, ui, message, channel_names);
                });
            });
        }
    });

    // Discord highlights the whole row with a subtle overlay.
    let row = egui::Rect::from_min_max(
        pos2(0.0, row_top),
        pos2(ui.max_rect().right(), ui.cursor().top()),
    );
    let response = ui.interact(
        row,
        egui::Id::new(("msg_row", message.id.as_str())),
        Sense::hover(),
    );
    if response.hovered() {
        ui.painter().rect_filled(row, 0.0, theme::ROW_HOVER);
        // Grouped messages reveal their time in the left gutter.
        if grouped {
            ui.painter().text(
                pos2(LEFT + AVATAR, row_top + 3.0),
                Align2::RIGHT_TOP,
                util::message_time(&message.timestamp),
                FontId::proportional(11.0),
                theme::MUTED,
            );
        }
    }

    // Curved connector from the author's avatar up to the reply excerpt.
    if let Some(band) = reply_band {
        let start = pos2(REPLY_AVATAR_X + 8.0, band.bottom() + 4.0);
        let end = pos2(REPLY_AVATAR_X, band.center().y);
        ui.painter().add(Shape::CubicBezier(
            egui::epaint::CubicBezierShape::from_points_stroke(
                [
                    start,
                    pos2(start.x, band.center().y + 2.0),
                    pos2(end.x + 8.0, band.center().y),
                    end,
                ],
                false,
                Color32::TRANSPARENT,
                egui::Stroke::new(1.5, theme::MUTED),
            ),
        ));
    }
}

fn reply_excerpt(app: &mut VesktopApp, ui: &mut egui::Ui, message: &Message) {
    let original = message.referenced_message.as_deref();
    ui.horizontal(|ui| {
        ui.add_space(REPLY_AVATAR_X);
        let (name, texture, color) = match original {
            Some(original) => {
                let name = original.author.display_name();
                let url = util::user_avatar_url(&original.author);
                (
                    name.to_string(),
                    app.images.get(ui.ctx(), &app.handle, &url),
                    util::name_color(name),
                )
            }
            None => ("Mensagem original".to_string(), None, theme::MUTED),
        };
        round_avatar(ui, texture.as_ref(), 16.0, &name, color);
        ui.add_space(6.0);
        ui.label(
            RichText::new(&name)
                .small()
                .strong()
                .color(util::name_color(&name)),
        );
        let excerpt = original.map(excerpt_text).unwrap_or_default();
        if !excerpt.is_empty() {
            ui.label(RichText::new(excerpt).small().color(theme::MUTED));
        }
    });
}

/// One-line, single-line excerpt of the replied-to message.
fn excerpt_text(message: &Message) -> String {
    let text = if message.content.is_empty() {
        if !message.attachments.is_empty() {
            format!("📎 {}", message.attachments[0].filename)
        } else if message.embeds.iter().any(|e| e.title.is_some()) {
            "Clique para ver o anexo".to_string()
        } else {
            String::new()
        }
    } else {
        message.content.replace('\n', " ")
    };
    let mut text = text;
    if text.chars().count() > 120 {
        text = text.chars().take(120).collect::<String>() + "…";
    }
    text
}

fn paint_content(
    app: &mut VesktopApp,
    ui: &mut egui::Ui,
    message: &Message,
    channel_names: &HashMap<String, String>,
) {
    if !message.content.is_empty() {
        let job = content_job(&message.content, &app.user_cache, channel_names);
        ui.add(Label::new(job));
    }
    for attachment in &message.attachments {
        if inline_image(app, ui, attachment) {
            continue;
        }
        let label = RichText::new(format!(
            "📎 {} ({})",
            attachment.filename,
            util::human_size(attachment.size)
        ))
        .small()
        .color(theme::BLURPLE)
        .underline();
        if ui
            .add(egui::Button::new(label).frame(false))
            .on_hover_text("Abrir no navegador")
            .clicked()
        {
            open_url(ui, attachment.url.as_deref());
        }
    }
    for embed in &message.embeds {
        if embed.title.is_none() && embed.description.is_none() {
            continue;
        }
        ui.horizontal(|ui| {
            let (bar, _) = ui.allocate_exact_size(Vec2::new(3.0, 30.0), Sense::hover());
            ui.painter().rect_filled(bar, 1.5, theme::BLURPLE);
            ui.vertical(|ui| {
                if let Some(title) = &embed.title {
                    ui.label(RichText::new(title).strong().color(theme::TEXT));
                }
                if let Some(description) = &embed.description {
                    ui.label(RichText::new(description).small().color(theme::MUTED));
                }
            });
        });
    }
}

/// Inline image attachment when it is an image with a URL; false otherwise.
fn inline_image(
    app: &mut VesktopApp,
    ui: &mut egui::Ui,
    attachment: &crate::model::Attachment,
) -> bool {
    let Some(url) = &attachment.url else {
        return false;
    };
    let is_image = attachment
        .content_type
        .as_deref()
        .is_some_and(|kind| kind.starts_with("image/"))
        || matches!(
            attachment.filename.rsplit('.').next(),
            Some("png" | "jpg" | "jpeg" | "gif" | "webp")
        );
    if !is_image {
        return false;
    }
    let Some(texture) = app.images_large.get(ui.ctx(), &app.handle, url) else {
        return true; // fetched: keep the line hidden while it loads
    };
    let size = texture.size_vec2();
    let scale = (INLINE_MAX / size.x).min(300.0 / size.y).min(1.0);
    let response = ui.add(
        Image::new((texture.id(), size * scale))
            .corner_radius(egui::CornerRadius::same(theme::RADIUS_SM as u8)),
    );
    if response.clicked() {
        open_url(ui, Some(url));
    }
    true
}

fn open_url(ui: &egui::Ui, url: Option<&str>) {
    if let Some(url) = url.filter(|url| !url.is_empty()) {
        ui.ctx().open_url(egui::OpenUrl::new_tab(url));
    }
}

fn conversation_start(app: &mut VesktopApp, ui: &mut egui::Ui, channel_id: &str) {
    let is_dm = matches!(app.channel_index.get(channel_id), Some(ChannelRef::Dm));
    let name = app.channel_name(channel_id);
    let texture = if is_dm {
        app.dm_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .and_then(|channel| channel.recipients.first())
            .map(|user| (user.display_name().to_string(), util::user_avatar_url(user)))
    } else {
        None
    };
    let (avatar_name, avatar_url, avatar_color) = match &texture {
        Some((name, url)) => (name.clone(), Some(url.clone()), util::name_color(name)),
        None => (name.clone(), None, theme::BLURPLE),
    };
    let loaded = avatar_url
        .as_deref()
        .and_then(|url| app.images.get(ui.ctx(), &app.handle, url));

    ui.vertical_centered(|ui| {
        ui.add_space(32.0);
        round_avatar(
            ui,
            loaded.as_ref(),
            80.0,
            if is_dm { &avatar_name } else { "#" },
            avatar_color,
        );
        ui.add_space(8.0);
        ui.label(
            RichText::new(if is_dm {
                avatar_name.clone()
            } else {
                format!("# {name}")
            })
            .size(20.0)
            .strong()
            .color(theme::TEXT),
        );
        ui.add_space(2.0);
        ui.label(
            RichText::new(if is_dm {
                format!("Este é o começo do seu histórico de mensagens diretas com @{name}.")
            } else {
                format!("Este é o começo do canal #{name}.")
            })
            .small()
            .color(theme::MUTED),
        );
        ui.add_space(8.0);
    });
}

fn date_separator(ui: &mut egui::Ui, label: &str) {
    ui.add_space(8.0);
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 20.0), Sense::hover());
    let painter = ui.painter();
    painter.line_segment(
        [
            pos2(rect.left(), rect.center().y),
            pos2(rect.right(), rect.center().y),
        ],
        egui::Stroke::new(1.0, theme::DIVIDER),
    );
    let galley =
        painter.layout_no_wrap(label.to_string(), FontId::proportional(12.0), theme::MUTED);
    let pad = 8.0;
    let label_rect =
        egui::Rect::from_center_size(rect.center(), galley.size() + Vec2::new(pad * 2.0, 0.0));
    painter.rect_filled(label_rect, 0.0, theme::CHAT);
    painter.galley(
        label_rect.min + Vec2::new(pad, (label_rect.height() - galley.size().y) / 2.0),
        galley,
        theme::MUTED,
    );
    ui.add_space(8.0);
}

/// Red "NOVAS" divider, Discord-style: line across, label at the left.
fn new_messages_divider(ui: &mut egui::Ui) {
    ui.add_space(6.0);
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 18.0), Sense::hover());
    let painter = ui.painter();
    painter.line_segment(
        [
            pos2(rect.left(), rect.center().y),
            pos2(rect.right(), rect.center().y),
        ],
        egui::Stroke::new(1.5, theme::RED),
    );
    let galley =
        painter.layout_no_wrap("NOVAS".to_string(), FontId::proportional(11.0), theme::RED);
    let pad = 6.0;
    let label_rect = egui::Rect::from_min_size(
        pos2(rect.left() + 14.0, rect.center().y - galley.size().y / 2.0),
        galley.size() + Vec2::new(pad * 2.0, 0.0),
    );
    painter.rect_filled(label_rect, 0.0, theme::CHAT);
    painter.galley(
        label_rect.min + Vec2::new(pad, (label_rect.height() - galley.size().y) / 2.0),
        galley,
        theme::RED,
    );
    ui.add_space(4.0);
}

/// "Ir para o presente", pinned above the compose box while scrolled up.
fn typing_label(names: &[String]) -> String {
    match names.len() {
        1 => format!("{} está digitando…", names[0]),
        2 => format!("{} e {} estão digitando…", names[0], names[1]),
        _ => format!("{}, {} e {} estão digitando…", names[0], names[1], names[2]),
    }
}

/// Maps markup segments to a styled `LayoutJob`, resolving mention and
/// channel ids against the state the caller already gathered.
fn content_job(
    text: &str,
    users: &HashMap<String, User>,
    channels: &HashMap<String, String>,
) -> LayoutJob {
    let mut job = LayoutJob::default();
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
        job.append(&text, 0.0, format);
    }
    job
}

/// Smiley face for the compose box emoji button.
fn draw_smiley(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.5, color);
    painter.circle_stroke(center, 7.0, stroke);
    painter.circle_filled(pos2(center.x - 2.5, center.y - 2.0), 1.1, color);
    painter.circle_filled(pos2(center.x + 2.5, center.y - 2.0), 1.1, color);
    let mouth: Vec<egui::Pos2> = (0..=6)
        .map(|i| {
            let t = i as f32 / 6.0;
            let angle = std::f32::consts::PI * (0.15 + 0.7 * t);
            pos2(
                center.x + 4.0 * angle.cos(),
                center.y + 4.0 * angle.sin() - 0.5,
            )
        })
        .collect();
    painter.add(egui::Shape::line(mouth, stroke));
}
