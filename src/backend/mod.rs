//! Backend: Discord REST API, gateway session and the typed channels that
//! connect them to the UI thread.

pub mod api;
pub mod events;
pub mod gateway;

pub use events::{Command, UiEvent};
