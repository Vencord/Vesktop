//! Experimental system tray, built only with `--features tray` and written
//! against tray-icon 0.19. Linux builds need GTK and libappindicator
//! development packages; adjust here if the tray-icon API moved.

use anyhow::Result;
use std::sync::mpsc::Sender;

use crate::app::TrayCommand;

pub fn install(quit_tx: Sender<TrayCommand>) -> Result<()> {
    use tray_icon::menu::{Menu, MenuEvent, MenuItem};
    use tray_icon::TrayIconBuilder;

    let menu = Menu::new();
    let quit = MenuItem::new("Sair do Vesktop", true, None);
    menu.append_items(&[&quit])?;

    let mut builder = TrayIconBuilder::with_id("vesktop-tray")
        .with_tooltip("Vesktop")
        .with_menu(Box::new(menu));
    if let Some(icon) = crate::window::load_tray_icon() {
        builder = builder.with_icon(icon);
    }
    // Leaked on purpose: the tray must outlive every frame.
    let _tray = builder.build()?;
    std::mem::forget(_tray);

    std::thread::spawn(move || {
        for event in MenuEvent::receiver().iter() {
            if event.id() == quit.id() {
                let _ = quit_tx.send(TrayCommand::Quit);
                break;
            }
        }
    });

    Ok(())
}
