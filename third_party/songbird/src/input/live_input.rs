use super::{AudioStream, Metadata, MetadataError, Parsed};

use symphonia_core::{
    codecs::{CodecRegistry, DecoderOptions},
    errors::Error as SymphError,
    formats::FormatOptions,
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::{Hint, Probe},
};

/// An initialised audio source.
///
/// This type's variants reflect files at different stages of readiness for use by
/// symphonia. [`Parsed`] file streams are ready for playback.
///
/// [`Parsed`]: Self::Parsed
pub enum LiveInput {
    /// An unread, raw file stream.
    Raw(AudioStream<Box<dyn MediaSource>>),
    /// An unread file which has been wrapped with a large read-ahead buffer.
    Wrapped(AudioStream<MediaSourceStream>),
    /// An audio file which has had its headers parsed and decoder state built.
    Parsed(Parsed),
}

impl LiveInput {
    /// Converts this audio source into a [`Parsed`] object using the supplied format and codec
    /// registries.
    ///
    /// Where applicable, this will convert [`Raw`] -> [`Wrapped`] -> [`Parsed`], and will
    /// play the default track (or the first encountered track if this is not available) if a
    /// container holds multiple audio streams.
    ///
    /// *This is a blocking operation. Symphonia uses standard library I/O (e.g., [`Read`], [`Seek`]).
    /// If you wish to use this from an async task, you must do so within `spawn_blocking`.*
    ///
    /// [`Parsed`]: Self::Parsed
    /// [`Raw`]: Self::Raw
    /// [`Wrapped`]: Self::Wrapped
    /// [`Read`]: https://doc.rust-lang.org/std/io/trait.Read.html
    /// [`Seek`]: https://doc.rust-lang.org/std/io/trait.Seek.html
    pub fn promote(self, codecs: &CodecRegistry, probe: &Probe) -> Result<Self, SymphError> {
        let mut out = self;

        if let LiveInput::Raw(r) = out {
            // TODO: allow passing in of MSS options?
            let mss = MediaSourceStream::new(r.input, MediaSourceStreamOptions::default());
            out = LiveInput::Wrapped(AudioStream { input: mss });
        }

        if let LiveInput::Wrapped(w) = out {
            let input = w.input;
            let supports_backseek = input.is_seekable();

            let probe_data = probe.format(
                // Hint is ignored
                &Hint::new(),
                input,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )?;
            let format = probe_data.format;
            let meta = probe_data.metadata;

            // if default track exists, try to make a decoder
            // if that fails, linear scan and take first that succeeds
            let decoder = format
                .default_track()
                .and_then(|track| {
                    codecs
                        .make(&track.codec_params, &DecoderOptions::default())
                        .ok()
                        .map(|d| (d, track.id))
                })
                .or_else(|| {
                    format.tracks().iter().find_map(|track| {
                        codecs
                            .make(&track.codec_params, &DecoderOptions::default())
                            .ok()
                            .map(|d| (d, track.id))
                    })
                });

            // No tracks is a playout error, a bad default track is also possible.
            // These are probably malformed? We could go best-effort, and fall back to tracks[0]
            // but drop such tracks for now.
            let (decoder, track_id) =
                decoder.ok_or(SymphError::DecodeError("no compatible track found"))?;

            let p = Parsed {
                format,
                decoder,
                track_id,
                meta,
                supports_backseek,
            };

            out = LiveInput::Parsed(p);
        }

        Ok(out)
    }

    /// Returns a reference to the data parsed from this input stream, if it has
    /// been made available via [`Self::promote`].
    #[must_use]
    pub fn parsed(&self) -> Option<&Parsed> {
        if let Self::Parsed(parsed) = self {
            Some(parsed)
        } else {
            None
        }
    }

    /// Returns a mutable reference to the data parsed from this input stream, if it
    /// has been made available via [`Self::promote`].
    pub fn parsed_mut(&mut self) -> Option<&mut Parsed> {
        if let Self::Parsed(parsed) = self {
            Some(parsed)
        } else {
            None
        }
    }

    /// Returns whether this stream's headers have been fully parsed, and so whether
    /// the track can be played or have its metadata read.
    #[must_use]
    pub fn is_playable(&self) -> bool {
        self.parsed().is_some()
    }

    /// Tries to get any information about this audio stream acquired during parsing.
    ///
    /// Only exists when this input is [`LiveInput::Parsed`].
    pub fn metadata(&mut self) -> Result<Metadata<'_>, MetadataError> {
        if let Some(parsed) = self.parsed_mut() {
            Ok(parsed.into())
        } else {
            Err(MetadataError::NotParsed)
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        constants::test_data::FILE_VID_TARGET,
        input::{codecs::*, File, Input},
    };

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn promote_finds_valid_audio() {
        // Video files often set their default to... the video stream, unsurprisingly.
        // In these cases we still want to play the attached audio -- this checks that songbird
        // finds the audio on a non-default track via `LiveInput::promote`.
        let input = Input::from(File::new(FILE_VID_TARGET));
        input
            .make_playable_async(get_codec_registry(), get_probe())
            .await
            .unwrap();
    }
}
