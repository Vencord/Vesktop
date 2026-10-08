use symphonia_core::{codecs::Decoder, formats::FormatReader, probe::ProbedMetadata};

/// An audio file which has had its headers parsed and decoder state built.
pub struct Parsed {
    /// Audio packet, seeking, and state access for all tracks in a file.
    ///
    /// This may be used to access packets one at a time from the input file.
    /// Additionally, this exposes container-level and per track metadata which
    /// have been extracted.
    pub format: Box<dyn FormatReader>,

    /// Decoder state for the chosen track.
    pub decoder: Box<dyn Decoder>,

    /// The chosen track's ID.
    ///
    /// This is required to identify the correct packet stream inside the container.
    pub track_id: u32,

    /// Metadata extracted by symphonia while detecting a file's format.
    ///
    /// Typically, this detects metadata *outside* the file's core format (i.e.,
    /// ID3 tags in MP3 and WAV files).
    pub meta: ProbedMetadata,

    /// Whether the contained format supports arbitrary seeking.
    ///
    /// If set to false, Songbird will attempt to recreate the input if
    /// it must seek backwards.
    pub supports_backseek: bool,
}
