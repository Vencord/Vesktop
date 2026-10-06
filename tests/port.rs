//! Integration test through the public crate API — also proves the library
//! builds standalone, not just as the binary's implementation detail.

use vesktop::markup::{self, Style};
use vesktop::settings::Settings;
use vesktop::util;

#[test]
fn markup_pipeline_end_to_end() {
    let segments = markup::tokenize("oi <@123> **veja** `código`");
    assert_eq!(segments.len(), 5);
    assert_eq!(segments[0].style, Style::Normal);
    assert_eq!(segments[1].style, Style::Mention);
    assert_eq!(segments[2].style, Style::Bold);
    assert_eq!(segments[3].style, Style::Normal);
    assert_eq!(segments[4].style, Style::Code);
}

#[test]
fn settings_defaults_serialize_and_reload() {
    let settings = Settings::default();
    let json = serde_json::to_string(&settings).expect("serialize");
    let reloaded: Settings = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(reloaded.theme, settings.theme);
    assert_eq!(reloaded.token, settings.token);
}

#[test]
fn snowflakes_order_matches_time() {
    let early = util::snowflake_ms("0").expect("snowflake");
    let late = util::snowflake_ms("4194304000").expect("snowflake");
    assert!(late > early);
}
