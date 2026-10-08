//! Screen share views (docs/SCREENSHARE.md): our own capture as a 16:9
//! "AO VIVO" preview above the "Voz conectada" block, and a watched live
//! (FockyTV or Go Live) in place of the chat.

use egui::{Rect, Vec2, pos2};

use crate::app::VesktopApp;
use crate::theme;

/// Margin around the preview box inside the sidebar.
const MARGIN: f32 = 8.0;

/// Height the preview takes in the sidebar's bottom block (0 when idle).
pub fn height(app: &VesktopApp, width: f32) -> f32 {
    if app.screen.is_none() {
        return 0.0;
    }
    (width - 2.0 * MARGIN) * 9.0 / 16.0 + MARGIN
}

/// Once per frame: drops an ended capture and uploads the newest frame.
pub fn poll(app: &mut VesktopApp, ctx: &egui::Context) {
    let Some(capture) = &app.screen else {
        return;
    };
    // The source went away, the picker was cancelled or FockyTV dropped us.
    let ended = capture.ended.lock().unwrap().take().or_else(|| {
        app.fockytv
            .as_ref()
            .and_then(|publisher| publisher.ended.lock().unwrap().take())
    });
    if let Some(reason) = ended {
        log::info!("compartilhamento encerrado: {reason}");
        app.stop_screen_share();
        return;
    }
    let Some(frame) = capture.frame.lock().unwrap().clone() else {
        return;
    };
    if frame.seq == capture.preview_seq {
        return;
    }
    if let Some(capture) = app.screen.as_mut() {
        capture.preview_seq = frame.seq;
    }
    // The sidebar box is ~224 px wide; 640 keeps it sharp on HiDPI.
    let (size, rgba) = frame.preview_rgba(640);
    let image = egui::ColorImage::from_rgba_unmultiplied(size, &rgba);
    match &mut app.screen_texture {
        Some(texture) => texture.set(image, egui::TextureOptions::LINEAR),
        None => {
            app.screen_texture =
                Some(ctx.load_texture("screen_share", image, egui::TextureOptions::LINEAR));
        }
    }
}

/// The preview box, letterboxed, with a "AO VIVO" badge.
pub fn paint(app: &VesktopApp, ui: &mut egui::Ui) {
    let width = ui.available_width();
    let h = height(app, width);
    if h == 0.0 {
        return;
    }
    let (row, _) = ui.allocate_exact_size(Vec2::new(width, h), egui::Sense::hover());
    let frame = Rect::from_min_max(
        pos2(row.left() + MARGIN, row.top() + MARGIN),
        pos2(row.right() - MARGIN, row.bottom()),
    );
    let painter = ui.painter();
    painter.rect_filled(frame, 6.0, egui::Color32::BLACK);
    match &app.screen_texture {
        Some(texture) => {
            let size = texture.size_vec2();
            let scale = (frame.width() / size.x).min(frame.height() / size.y);
            let fitted = Rect::from_center_size(frame.center(), size * scale);
            egui::Image::new((texture.id(), fitted.size()))
                .corner_radius(4)
                .paint_at(ui, fitted);
        }
        None => {
            painter.text(
                frame.center(),
                egui::Align2::CENTER_CENTER,
                "Escolha a tela…",
                egui::FontId::proportional(12.0),
                theme::MUTED,
            );
        }
    }
    let badge = egui::Rect::from_min_size(frame.min + Vec2::splat(6.0), Vec2::new(54.0, 18.0));
    painter.rect_filled(badge, 4.0, theme::RED);
    painter.text(
        badge.center(),
        egui::Align2::CENTER_CENTER,
        "AO VIVO",
        egui::FontId::proportional(10.5),
        egui::Color32::WHITE,
    );
}

/// A watched stream in place of the chat: the video, letterboxed, with a
/// bar to leave it.
pub fn paint_watch(app: &mut VesktopApp, ui: &mut egui::Ui) {
    let Some(watch) = &app.watch else {
        return;
    };
    // A FockyTV live that ended (or never started) closes the view.
    let ended = watch
        .fockytv
        .as_ref()
        .and_then(|viewer| viewer.ended.lock().unwrap().take());
    if let Some(reason) = ended {
        log::info!("fockytv: {reason}");
        app.stop_watching();
        return;
    }
    let title = match watch.key.strip_prefix("fockytv:") {
        Some(key) => format!("Assistindo {key} no FockyTV"),
        None => "Assistindo à transmissão".to_string(),
    };
    let frame = watch.frames.lock().unwrap().take();
    if let Some(frame) = frame {
        // Decoded frames are already RGBA; only captures need swizzling.
        let image = if frame.bgr {
            let (size, rgba) = frame.preview_rgba(frame.width);
            egui::ColorImage::from_rgba_unmultiplied(size, &rgba)
        } else {
            egui::ColorImage::from_rgba_unmultiplied(
                [frame.width as usize, frame.height as usize],
                &frame.pixels,
            )
        };
        match &mut app.watch_texture {
            Some(texture) => texture.set(image, egui::TextureOptions::LINEAR),
            None => {
                app.watch_texture =
                    Some(ui.ctx().load_texture("watch_stream", image, egui::TextureOptions::LINEAR));
            }
        }
    }
    let mut leave = false;
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(title).strong().color(theme::TEXT));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            leave = ui.button("Parar de assistir").clicked();
        });
    });
    let area = ui.available_rect_before_wrap();
    ui.painter().rect_filled(area, 6.0, egui::Color32::BLACK);
    match &app.watch_texture {
        Some(texture) => {
            let size = texture.size_vec2();
            let scale = (area.width() / size.x).min(area.height() / size.y);
            egui::Image::new((texture.id(), size * scale))
                .paint_at(ui, Rect::from_center_size(area.center(), size * scale));
        }
        None => {
            ui.painter().text(
                area.center(),
                egui::Align2::CENTER_CENTER,
                "Conectando à transmissão…",
                egui::FontId::proportional(14.0),
                theme::MUTED,
            );
        }
    }
    if leave {
        app.stop_watching();
    }
}
