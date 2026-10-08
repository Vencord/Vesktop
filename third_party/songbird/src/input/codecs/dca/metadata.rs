use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct DcaMetadata {
    pub dca: DcaInfo,
    pub opus: Opus,
    pub info: Option<Info>,
    pub origin: Option<Origin>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DcaInfo {
    pub version: u64,
    pub tool: Tool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Tool {
    pub name: String,
    pub version: String,
    pub url: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Opus {
    pub mode: String,
    pub sample_rate: u32,
    pub frame_size: u64,
    pub abr: Option<u64>,
    pub vbr: bool,
    pub channels: u8,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Info {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub cover: Option<String>,
    pub comments: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Origin {
    pub source: Option<String>,
    pub abr: Option<u64>,
    pub channels: Option<u8>,
    pub encoding: Option<String>,
    pub url: Option<String>,
}
