//! Small pure helpers: snowflake math, timestamps, CDN URLs, name colors.

use crate::model::{Guild, User};
use chrono::{DateTime, Local};
use egui::Color32;

/// Discord epoch: 2015-01-01T00:00:00.000+00:00.
const DISCORD_EPOCH: u64 = 1_420_070_400_000;

/// Creation timestamp of a snowflake ID, in milliseconds since the epoch.
pub fn snowflake_ms(id: &str) -> Option<i64> {
    id.parse::<u64>()
        .ok()
        .map(|value| ((value >> 22) + DISCORD_EPOCH) as i64)
}

/// `HH:MM` in the local timezone for an ISO-8601 timestamp.
pub fn message_time(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|time| time.with_timezone(&Local).format("%H:%M").to_string())
        .unwrap_or_default()
}

/// `DD/MM/YYYY` in the local timezone for an ISO-8601 timestamp.
pub fn day_label(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|time| time.with_timezone(&Local).format("%d/%m/%Y").to_string())
        .unwrap_or_default()
}

/// A stable, pleasant color for a username, derived from its content.
pub fn name_color(name: &str) -> Color32 {
    let mut hash: u32 = 5381;
    for byte in name.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u32);
    }
    let hue = (hash % 360) as f32 / 360.0;
    Color32::from(egui::ecolor::Hsva::new(hue, 0.5, 0.75, 1.0))
}

pub fn user_avatar_url(user: &User) -> String {
    match &user.avatar {
        Some(hash) => format!(
            "https://cdn.discordapp.com/avatars/{}/{}.png?size=64",
            user.id, hash
        ),
        None => format!(
            "https://cdn.discordapp.com/embed/avatars/{}.png",
            user
                .id
                .parse::<u64>()
                .map(|value| (value >> 22) % 6)
                .unwrap_or(0)
        ),
    }
}

pub fn guild_icon_url(guild: &Guild) -> Option<String> {
    let hash = guild.icon.as_deref()?;
    Some(format!(
        "https://cdn.discordapp.com/icons/{}/{}.png?size=64",
        guild.id, hash
    ))
}

/// "12 KB" style file sizes.
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snowflake_decodes_discord_epoch_ids() {
        // Snowflake 0 is, by definition, minted at the Discord epoch.
        assert_eq!(snowflake_ms("0"), Some(1_420_070_400_000));
        // 2^22 shifts to exactly one millisecond past it.
        assert_eq!(snowflake_ms("4194304"), Some(1_420_070_400_001));
    }

    #[test]
    fn snowflake_rejects_garbage() {
        assert_eq!(snowflake_ms("not-a-snowflake"), None);
    }

    #[test]
    fn human_size_is_readable() {
        assert_eq!(human_size(12), "12 B");
        assert_eq!(human_size(2048), "2.0 KB");
        assert_eq!(human_size(5 * 1024 * 1024), "5.0 MB");
    }
}
