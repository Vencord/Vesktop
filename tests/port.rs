//! Integration test through the public crate API — also proves the library
//! builds standalone, not just as the binary's implementation detail.

use vesktop::markup::{self, Style};
use vesktop::settings::Settings;
use vesktop::util;

#[test]
fn markup_pipeline_end_to_end() {
    let segments = markup::tokenize("oi <@123> **veja** `código`");
    let styles: Vec<Style> = segments.iter().map(|s| s.style).collect();
    assert_eq!(
        styles,
        [Style::Normal, Style::Mention, Style::Normal, Style::Bold, Style::Normal, Style::Code]
    );
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
