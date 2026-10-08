//! Screen share preview (docs/SCREENSHARE.md, phase 1): the captured
//! frames, painted in a 16:9 box above the "Voz conectada" block, so the
//! portal + PipeWire path can be checked before anything goes to Discord.

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
    // The source went away or the picker was cancelled.
    let ended = capture.ended.lock().unwrap().take();
    if let Some(reason) = ended {
        log::info!("compartilhamento encerrado: {reason}");
        app.stop_screen_share();
        return;
    }
    let Some(frame) = capture.frame.lock().unwrap().take() else {
        return;
    };
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
    let frame = watch.frames.lock().unwrap().take();
    if let Some(frame) = frame {
        let (size, rgba) = frame.preview_rgba(frame.width);
        let image = egui::ColorImage::from_rgba_unmultiplied(size, &rgba);
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
        ui.label(egui::RichText::new("Assistindo à transmissão").strong().color(theme::TEXT));
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
