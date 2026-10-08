//! `YoutubeDl` track metadata.

use super::AuxMetadata;
use crate::constants::SAMPLE_RATE_RAW;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

/// Information returned by yt-dlp about a URL.
///
/// Returned by [`crate::input::YoutubeDl::query`].
#[derive(Deserialize, Serialize, Debug)]
pub struct Output {
    /// The main artist.
    pub artist: Option<String>,
    /// The album name.
    pub album: Option<String>,
    /// The channel name.
    pub channel: Option<String>,
    /// The duration of the stream in seconds.
    pub duration: Option<f64>,
    /// The size of the stream.
    pub filesize: Option<u64>,
    /// Required HTTP headers to fetch the track stream.
    pub http_headers: Option<HashMap<String, String>>,
    /// Release date of this track.
    pub release_date: Option<String>,
    /// The thumbnail URL for this track.
    pub thumbnail: Option<String>,
    /// The title of this track.
    pub title: Option<String>,
    /// The track name.
    pub track: Option<String>,
    /// The date this track was uploaded on.
    pub upload_date: Option<String>,
    /// The name of the uploader.
    pub uploader: Option<String>,
    /// The stream URL.
    pub url: String,
    /// The URL of the public-facing webpage for this track.
    pub webpage_url: Option<String>,
    /// The stream protocol.
    pub protocol: Option<String>,
}

impl Output {
    /// Requests auxiliary metadata which can be accessed without parsing the file.
    pub fn as_aux_metadata(&self) -> AuxMetadata {
        let album = self.album.clone();
        let track = self.track.clone();
        let true_artist = self.artist.as_ref();
        let artist = true_artist.or(self.uploader.as_ref()).cloned();
        let r_date = self.release_date.as_ref();
        let date = r_date.or(self.upload_date.as_ref()).cloned();
        let channel = self.channel.clone();
        let duration = self.duration.map(Duration::from_secs_f64);
        let source_url = self.webpage_url.clone();
        let title = self.title.clone();
        let thumbnail = self.thumbnail.clone();

        AuxMetadata {
            track,
            artist,
            album,
            date,

            channels: Some(2),
            channel,
            duration,
            sample_rate: Some(SAMPLE_RATE_RAW as u32),
            source_url,
            title,
            thumbnail,

            ..AuxMetadata::default()
        }
    }
}
