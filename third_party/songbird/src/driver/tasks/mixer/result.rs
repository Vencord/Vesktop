use crate::{
    input::AudioStreamError,
    tracks::{PlayError, SeekRequest},
};
use std::sync::Arc;
use symphonia_core::errors::Error as SymphoniaError;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MixType {
    Passthrough(usize),
    MixedPcm(usize),
}

pub enum MixStatus {
    Live,
    Ended,
    Errored(SymphoniaError),
}

impl From<SymphoniaError> for MixStatus {
    fn from(e: SymphoniaError) -> Self {
        Self::Errored(e)
    }
}

// The Symph errors are Arc'd here since if they come up, they will always
// be Arc'd anyway via into_user.
#[derive(Clone, Debug)]
pub enum InputReadyingError {
    Parsing(Arc<SymphoniaError>),
    Creation(Arc<AudioStreamError>),
    Seeking(Arc<SymphoniaError>),
    Dropped,
    Waiting,
    NeedsSeek(SeekRequest),
}

impl InputReadyingError {
    pub fn as_user(&self) -> Option<PlayError> {
        match self {
            Self::Parsing(e) => Some(PlayError::Parse(e.clone())),
            Self::Creation(e) => Some(PlayError::Create(e.clone())),
            Self::Seeking(e) => Some(PlayError::Seek(e.clone())),
            _ => None,
        }
    }

    pub fn into_seek_request(self) -> Option<SeekRequest> {
        if let Self::NeedsSeek(a) = self {
            Some(a)
        } else {
            None
        }
    }
}
