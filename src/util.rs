//! Small pure helpers: snowflake math, timestamps, CDN URLs, name colors.

use crate::model::{Guild, User};
use chrono::{DateTime, Datelike, Local};
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

/// Discord's pt-BR date separator label, e.g. "6 de outubro de 2026".
pub fn day_label_long(iso: &str) -> String {
    const MONTHS: [&str; 12] = [
        "janeiro",
        "fevereiro",
        "março",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro",
    ];
    DateTime::parse_from_rfc3339(iso)
        .map(|time| {
            let local = time.with_timezone(&Local);
            format!(
                "{} de {} de {}",
                local.day(),
                MONTHS[(local.month0() as usize).min(11)],
                local.year()
            )
        })
        .unwrap_or_default()
}

/// The date a timestamp falls on, in the local timezone.
pub fn local_day(iso: &str) -> Option<chrono::NaiveDate> {
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|time| time.with_timezone(&Local).date_naive())
}

/// Message header time, Discord-style: "Hoje às 14:32", "Ontem às 09:10" or
/// the plain date. Returns `(label, exact time)` — the latter for the tooltip.
pub fn header_time(iso: &str) -> (String, String) {
    let Ok(time) = DateTime::parse_from_rfc3339(iso) else {
        return (String::new(), String::new());
    };
    let local = time.with_timezone(&Local);
    let hhmm = local.format("%H:%M").to_string();
    let exact = local.format("%d/%m/%Y %H:%M").to_string();
    let today = Local::now().date_naive();
    let day = local.date_naive();
    if day == today {
        (format!("Hoje às {hhmm}"), exact)
    } else if Some(day) == today.pred_opt() {
        (format!("Ontem às {hhmm}"), exact)
    } else {
        (day_label(iso), exact)
    }
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
            user.id
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
