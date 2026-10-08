use std::{error::Error, fmt::Display, time::Duration};
use symphonia_core::errors::Error as SymphError;

/// Errors encountered when creating an [`AudioStream`] or requesting metadata
/// from a [`Compose`].
///
/// [`AudioStream`]: super::AudioStream
/// [`Compose`]: super::Compose
#[non_exhaustive]
#[derive(Debug)]
pub enum AudioStreamError {
    /// The operation failed, and should be retried after a given time.
    ///
    /// Create operations invoked by the driver will retry on the first tick
    /// after this time has passed.
    RetryIn(Duration),
    /// The operation failed, and should not be retried.
    Fail(Box<dyn Error + Send + Sync>),
    /// The operation was not supported, and will never succeed.
    Unsupported,
}

impl Display for AudioStreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("failed to create audio: ")?;
        match self {
            Self::RetryIn(t) => f.write_fmt(format_args!("retry in {:.2}s", t.as_secs_f32())),
            Self::Fail(why) => f.write_fmt(format_args!("{why}")),
            Self::Unsupported => f.write_str("operation was not supported"),
        }
    }
}

impl Error for AudioStreamError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        None
    }
}

/// Errors encountered when readying or pre-processing an [`Input`].
///
/// [`Input`]: super::Input
#[non_exhaustive]
#[derive(Debug)]
pub enum MakePlayableError {
    /// Failed to create a [`LiveInput`] from the lazy [`Compose`].
    ///
    /// [`LiveInput`]: super::LiveInput
    /// [`Compose`]: super::Compose
    Create(AudioStreamError),
    /// Failed to read headers, codecs, or a valid stream from a [`LiveInput`].
    ///
    /// [`LiveInput`]: super::LiveInput
    Parse(SymphError),
    /// A blocking thread panicked or failed to return a parsed input.
    Panicked,
}

impl Display for MakePlayableError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("failed to make track playable: ")?;
        match self {
            Self::Create(c) => {
                f.write_str("input creation [")?;
                f.write_fmt(format_args!("{}", &c))?;
                f.write_str("]")
            },
            Self::Parse(p) => {
                f.write_str("parsing formats/codecs [")?;
                f.write_fmt(format_args!("{}", &p))?;
                f.write_str("]")
            },
            Self::Panicked => f.write_str("panic during blocking I/O in parse"),
        }
    }
}

impl Error for MakePlayableError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        None
    }
}

impl From<AudioStreamError> for MakePlayableError {
    fn from(val: AudioStreamError) -> Self {
        Self::Create(val)
    }
}

impl From<SymphError> for MakePlayableError {
    fn from(val: SymphError) -> Self {
        Self::Parse(val)
    }
}

/// Errors encountered when trying to access in-stream [`Metadata`] for an [`Input`].
///
/// Both cases can be solved by using [`Input::make_playable`] or [`LiveInput::promote`].
///
/// [`Input`]: super::Input
/// [`Metadata`]: super::Metadata
/// [`Input::make_playable`]: super::Input::make_playable
/// [`LiveInput::promote`]: super::LiveInput::promote
#[non_exhaustive]
#[derive(Debug)]
pub enum MetadataError {
    /// This input is currently lazily initialised, and must be made live.
    NotLive,
    /// This input is ready, but has not had its headers parsed.
    NotParsed,
}

impl Display for MetadataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("failed to get metadata: ")?;
        match self {
            Self::NotLive => f.write_str("the input is not live, and hasn't been parsed"),
            Self::NotParsed => f.write_str("the input is live but hasn't been parsed"),
        }
    }
}

impl Error for MetadataError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        None
    }
}

/// Errors encountered when trying to access out-of-band [`AuxMetadata`] for an [`Input`]
/// or [`Compose`].
///
/// [`Input`]: super::Input
/// [`AuxMetadata`]: super::AuxMetadata
/// [`Compose`]: super::Compose
#[non_exhaustive]
#[derive(Debug)]
pub enum AuxMetadataError {
    /// This input has no lazy [`Compose`] initialiser, which is needed to
    /// retrieve [`AuxMetadata`].
    ///
    /// [`Compose`]: super::Compose
    /// [`AuxMetadata`]: super::AuxMetadata
    NoCompose,
    /// There was an error when trying to access auxiliary metadata.
    Retrieve(AudioStreamError),
}

impl Display for AuxMetadataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("failed to get aux_metadata: ")?;
        match self {
            Self::NoCompose => f.write_str("the input has no Compose object"),
            Self::Retrieve(e) => f.write_fmt(format_args!("aux_metadata error from Compose: {e}")),
        }
    }
}

impl Error for AuxMetadataError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        None
    }
}

impl From<AudioStreamError> for AuxMetadataError {
    fn from(val: AudioStreamError) -> Self {
        Self::Retrieve(val)
    }
}
