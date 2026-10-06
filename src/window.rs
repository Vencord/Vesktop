//! Window icon (and, behind the `tray` feature, the tray icon) decoded from
//! the assets carried over from the upstream Electron app.

use egui::IconData;

const APP_ICON: &[u8] = include_bytes!("../assets/icon.ico");

pub fn load_icon() -> Option<IconData> {
    let img = image::load_from_memory(APP_ICON).ok()?.into_rgba8();
    let (width, height) = img.dimensions();
    Some(IconData {
        width: width as usize,
        height: height as usize,
        rgba: img.into_raw(),
    })
}

#[cfg(feature = "tray")]
pub fn load_tray_icon() -> Option<tray_icon::Icon> {
    const TRAY_ICON: &[u8] = include_bytes!("../assets/tray.png");
    let img = image::load_from_memory(TRAY_ICON).ok()?.into_rgba8();
    let (width, height) = img.dimensions();
    tray_icon::Icon::from_rgba(img.into_raw(), width, height).ok()
}
