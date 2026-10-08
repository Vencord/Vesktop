//! Client settings, persisted as JSON in the user's config directory — the
//! native equivalent of Vesktop's Electron `settings.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Discord account token.
    ///
    /// Kept next to the other settings for now; moving it into the OS
    /// keyring (the spotifast pattern) is tracked in docs/PORT.md.
    pub token: Option<String>,
    pub theme: Theme,
    /// Interface zoom multiplier on top of the native scale factor.
    pub zoom: f32,
    pub selected_guild_id: Option<String>,
    pub selected_channel_id: Option<String>,
    /// Last open channel per guild, so switching servers restores context.
    pub last_channel_by_guild: HashMap<String, String>,
    pub tray: bool,
    pub minimize_to_tray: bool,
    pub check_for_updates: bool,
    /// Voice: chosen sound-server device names (`None` = system default).
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    /// Voice-activity threshold, 0 (sempre aberto) to 100.
    pub input_sensitivity: u8,
    /// RNNoise-style microphone noise suppression.
    pub noise_suppression: bool,
    /// Per-user playback volume, as a percentage (100 = normal).
    pub user_volumes: HashMap<String, u8>,
    /// Screen share through FockyTV (WHIP) instead of Discord's Go Live,
    /// which stays in the code for later (docs/SCREENSHARE.md).
    pub fockytv_share: bool,
    pub fockytv_url: String,
    /// Stream key on FockyTV; `None` = the Discord username, which is also
    /// how others' lives are matched to voice members.
    pub fockytv_nick: Option<String>,
    /// Frame rate cap for FockyTV broadcasts: 60, 30 or 15.
    pub fockytv_fps: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            token: None,
            theme: Theme::Dark,
            zoom: 1.0,
            selected_guild_id: None,
            selected_channel_id: None,
            last_channel_by_guild: HashMap::new(),
            tray: true,
            minimize_to_tray: true,
            check_for_updates: true,
            input_device: None,
            output_device: None,
            input_sensitivity: 0,
            noise_suppression: false,
            user_volumes: HashMap::new(),
            fockytv_share: true,
            fockytv_url: "https://tv.huestavo.com".into(),
            fockytv_nick: None,
            fockytv_fps: 60,
        }
    }
}

impl Settings {
    pub fn load() -> Option<Self> {
        let file = std::fs::read_to_string(crate::paths::settings_file()).ok()?;
        match serde_json::from_str(&file) {
            Ok(settings) => Some(settings),
            Err(err) => {
                log::warn!("settings file is invalid, using defaults: {err}");
                None
            }
        }
    }

    pub fn save(&self) {
        let file = crate::paths::settings_file();
        if let Some(dir) = file.parent() {
            if let Err(err) = std::fs::create_dir_all(dir) {
                log::error!("failed to create config dir: {err}");
                return;
            }
        }
        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(err) = std::fs::write(&file, json) {
                    log::error!("failed to save settings: {err}");
                }
            }
            Err(err) => log::error!("failed to serialize settings: {err}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip_through_json() {
        let mut settings = Settings::default();
        settings.theme = Theme::Light;
        settings.zoom = 1.25;
        settings.token = Some("abc".to_string());
        settings
            .last_channel_by_guild
            .insert("g".into(), "c".into());

        let json = serde_json::to_string(&settings).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.theme, Theme::Light);
        assert_eq!(back.zoom, 1.25);
        assert_eq!(back.token.as_deref(), Some("abc"));
        assert_eq!(
            back.last_channel_by_guild.get("g").map(String::as_str),
            Some("c")
        );
    }

    #[test]
    fn partial_json_fills_defaults() {
        let back: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(back.theme, Theme::Dark);
        assert!((back.zoom - 1.0).abs() < f32::EPSILON);
        assert_eq!(back.token, None);
    }
}
