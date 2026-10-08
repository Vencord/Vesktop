//! FastDiscord — a native Discord client built with Rust and egui.
//!
//! This crate is the Rust port of the Electron-based Vesktop desktop app:
//! the UI is drawn directly with egui instead of hosting discord.com in a
//! browser engine, and the Discord REST + Gateway protocols are spoken
//! natively over tokio.

pub mod app;
pub mod backend;
pub mod image_cache;
pub mod markup;
pub mod model;
pub mod paths;
pub mod settings;
pub mod theme;
#[cfg(feature = "tray")]
pub mod tray;
pub mod ui;
pub mod util;
pub mod window;
