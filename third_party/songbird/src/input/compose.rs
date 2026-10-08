use super::{AudioStream, AudioStreamError, AuxMetadata};

use symphonia_core::io::MediaSource;

/// Data and behaviour required to instantiate a lazy audio source.
#[async_trait::async_trait]
pub trait Compose: Send {
    /// Create a source synchronously.
    ///
    /// If [`should_create_async`] returns `false`, this method will chosen at runtime.
    ///
    /// [`should_create_async`]: Self::should_create_async
    fn create(&mut self) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError>;

    /// Create a source asynchronously.
    ///
    /// If [`should_create_async`] returns `true`, this method will chosen at runtime.
    ///
    /// [`should_create_async`]: Self::should_create_async
    async fn create_async(&mut self)
        -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError>;

    /// Determines whether this source will be instantiated using [`create`] or [`create_async`].
    ///
    /// Songbird will create the audio stream using either a dynamically sized thread pool,
    /// or a task on the async runtime it was spawned in respectively. Users do not need to
    /// support both these methods.
    ///
    /// [`create_async`]: Self::create_async
    /// [`create`]: Self::create
    fn should_create_async(&self) -> bool;

    /// Requests auxiliary metadata which can be accessed without parsing the file.
    ///
    /// This method will never be called by songbird but allows, for instance, access to metadata
    /// which might only be visible to a web crawler e.g., uploader or source URL.
    async fn aux_metadata(&mut self) -> Result<AuxMetadata, AudioStreamError> {
        Err(AudioStreamError::Unsupported)
    }
}
