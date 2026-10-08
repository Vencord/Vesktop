use super::AuxMetadata;
use serde::{Deserialize, Serialize};
use serde_aux::prelude::*;
use std::{collections::HashMap, time::Duration};

// These have been put together by looking at ffprobe's output
// and the canonical data formats given in
// https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffprobe.xsd

#[derive(Deserialize, Serialize)]
pub struct Output {
    pub streams: Vec<Stream>,
    pub format: Format,
}

#[derive(Deserialize, Serialize)]
pub struct Stream {
    pub index: u64,
    pub codec_name: Option<String>,
    pub codec_long_name: Option<String>,
    pub profile: Option<String>,
    pub codec_type: Option<String>,
    pub codec_tag: String,
    pub codec_tag_string: String,
    pub extradata: Option<String>,
    pub extradata_size: Option<u64>,
    pub extradata_hash: Option<String>,

    // Video attributes skipped.
    pub sample_fmt: Option<String>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    pub bits_per_sample: Option<u32>,

    pub id: Option<String>,
    pub r_frame_rate: String,
    pub avg_frame_rate: String,
    pub time_base: String,
    pub start_pts: Option<i64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub start_time: Option<f64>,
    pub duration_ts: Option<u64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub duration: Option<f64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub bit_rate: Option<u64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub max_bit_rate: Option<u64>,
    pub bits_per_raw_sample: Option<u64>,
    pub nb_frames: Option<u64>,
    pub nb_read_frames: Option<u64>,
    pub nb_read_packets: Option<u64>,

    // Side Data List skipped.
    pub disposition: Option<Disposition>,
    pub tags: Option<HashMap<String, String>>,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Deserialize, Serialize)]
pub struct Disposition {
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub default: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub dub: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub original: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub comment: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub lyrics: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub karaoke: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub forced: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub hearing_impaired: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub visual_impaired: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub clean_effects: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub attached_pic: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub timed_thumbnails: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub captions: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub descriptions: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub metadata: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub dependent: bool,
    #[serde(deserialize_with = "deserialize_bool_from_anything")]
    pub still_image: bool,
}

#[derive(Deserialize, Serialize)]
pub struct Format {
    pub filename: String,
    pub nb_streams: u64,
    pub nb_programs: u64,
    #[serde(rename = "format_name")]
    pub name: String,
    #[serde(rename = "format_long_name")]
    pub long_name: Option<String>,

    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub start_time: Option<f64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub duration: Option<f64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub size: Option<u64>,
    #[serde(deserialize_with = "deserialize_option_number_from_string")]
    pub bit_rate: Option<u64>,

    pub probe_score: i64,
    pub tags: Option<HashMap<String, String>>,
}

fn apply_tags(tag_map: HashMap<String, String>, dest: &mut AuxMetadata) {
    for (k, v) in tag_map {
        match k.as_str().to_lowercase().as_str() {
            "title" => dest.title = Some(v),
            "album" => dest.album = Some(v),
            "artist" => dest.artist = Some(v),
            "date" => dest.date = Some(v),
            "channels" =>
                if let Ok(chans) = str::parse::<u8>(&v) {
                    dest.channels = Some(chans);
                },
            "sample_rate" =>
                if let Ok(samples) = str::parse::<u32>(&v) {
                    dest.sample_rate = Some(samples);
                },
            _ => {},
        }
    }
}

impl Output {
    pub fn into_aux_metadata(self) -> AuxMetadata {
        let duration = self.format.duration.map(Duration::from_secs_f64);
        let start_time = self
            .format
            .duration
            .map(|v| v.max(0.0))
            .map(Duration::from_secs_f64);

        let mut out = AuxMetadata {
            start_time,
            duration,

            ..AuxMetadata::default()
        };

        if let Some(tags) = self.format.tags {
            apply_tags(tags, &mut out);
        }

        for stream in self.streams {
            if stream.codec_type.as_deref() != Some("audio") {
                continue;
            }

            if let Some(tags) = stream.tags {
                apply_tags(tags, &mut out);
            }
        }

        out
    }
}
