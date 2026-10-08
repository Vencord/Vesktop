//! Metadata formats specific to [`crate::input::Compose`] types.

use crate::error::JsonError;
use std::time::Duration;
use symphonia_core::{meta::Metadata as ContainerMetadata, probe::ProbedMetadata};

pub(crate) mod ffprobe;
mod ytdl;
pub use ytdl::Output as YoutubeDlOutput;

use super::Parsed;

/// Extra information about an [`Input`] which is acquired without
/// parsing the file itself (e.g., from a webpage).
///
/// You can access this via [`Input::aux_metadata`] and [`Compose::aux_metadata`].
///
/// [`Input`]: crate::input::Input
/// [`Input::aux_metadata`]: crate::input::Input::aux_metadata
/// [`Compose::aux_metadata`]: crate::input::Compose::aux_metadata
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AuxMetadata {
    /// The track name of this stream.
    pub track: Option<String>,
    /// The main artist of this stream.
    pub artist: Option<String>,
    /// The album name of this stream.
    pub album: Option<String>,
    /// The date of creation of this stream.
    pub date: Option<String>,

    /// The number of audio channels in this stream.
    pub channels: Option<u8>,
    /// The YouTube channel of this stream.
    pub channel: Option<String>,
    /// The time at which the first true sample is played back.
    ///
    /// This occurs as an artefact of coder delay.
    pub start_time: Option<Duration>,
    /// The reported duration of this stream.
    pub duration: Option<Duration>,
    /// The sample rate of this stream.
    pub sample_rate: Option<u32>,
    /// The source url of this stream.
    pub source_url: Option<String>,
    /// The YouTube title of this stream.
    pub title: Option<String>,
    /// The thumbnail url of this stream.
    pub thumbnail: Option<String>,
}

impl AuxMetadata {
    /// Extract metadata and details from the output of `ffprobe -of json`.
    pub fn from_ffprobe_json(value: &mut [u8]) -> Result<Self, JsonError> {
        let output: ffprobe::Output = serde_json::from_slice(value)?;

        Ok(output.into_aux_metadata())
    }

    /// Move all fields from an [`AuxMetadata`] object into a new one.
    #[must_use]
    pub fn take(&mut self) -> Self {
        Self {
            track: self.track.take(),
            artist: self.artist.take(),
            album: self.album.take(),
            date: self.date.take(),
            channels: self.channels.take(),
            channel: self.channel.take(),
            start_time: self.start_time.take(),
            duration: self.duration.take(),
            sample_rate: self.sample_rate.take(),
            source_url: self.source_url.take(),
            title: self.title.take(),
            thumbnail: self.thumbnail.take(),
        }
    }
}

/// In-stream information about an [`Input`] acquired by parsing an audio file.
///
/// To access this, the [`Input`] must be made live and parsed by symphonia. To do
/// this, you can:
/// * Pre-process the track in your own code using [`Input::make_playable`], and
///   then [`Input::metadata`].
/// * Use [`TrackHandle::action`] to access the track's metadata via [`View`],
///   *if the track has started or been made playable*.
///
/// You probably want to use [`AuxMetadata`] instead; this requires a live track,
/// which has higher memory use for buffers etc.
///
/// [`Input`]: crate::input::Input
/// [`Input::make_playable`]: super::Input::make_playable
/// [`Input::metadata`]: super::Input::metadata
/// [`TrackHandle::action`]: crate::tracks::TrackHandle::action
/// [`View`]: crate::tracks::View
pub struct Metadata<'a> {
    /// Metadata found while probing for the format of an [`Input`] (e.g., ID3 tags).
    ///
    /// [`Input`]: crate::input::Input
    pub probe: &'a mut ProbedMetadata,
    /// Metadata found inside the format/container of an audio stream.
    pub format: ContainerMetadata<'a>,
}

impl<'a> From<&'a mut Parsed> for Metadata<'a> {
    fn from(val: &'a mut Parsed) -> Self {
        Metadata {
            probe: &mut val.meta,
            format: val.format.metadata(),
        }
    }
}
