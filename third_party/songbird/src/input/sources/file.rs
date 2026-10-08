use crate::input::{AudioStream, AudioStreamError, Compose, Input};
use std::{error::Error, path::Path};
use symphonia_core::io::MediaSource;

/// A lazily instantiated local file.
#[derive(Clone, Debug)]
pub struct File<P: AsRef<Path>> {
    path: P,
}

impl<P: AsRef<Path>> File<P> {
    /// Creates a lazy file object, which will open the target path.
    ///
    /// This is infallible as the path is only checked during creation.
    pub fn new(path: P) -> Self {
        Self { path }
    }
}

impl<P: AsRef<Path> + Send + Sync + 'static> From<File<P>> for Input {
    fn from(val: File<P>) -> Self {
        Input::Lazy(Box::new(val))
    }
}

#[async_trait::async_trait]
impl<P: AsRef<Path> + Send + Sync> Compose for File<P> {
    fn create(&mut self) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        let err: Box<dyn Error + Send + Sync> =
            "Files should be created asynchronously.".to_string().into();
        Err(AudioStreamError::Fail(err))
    }

    async fn create_async(
        &mut self,
    ) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        let file = tokio::fs::File::open(&self.path)
            .await
            .map_err(|io| AudioStreamError::Fail(Box::new(io)))?;

        let input = Box::new(file.into_std().await);
        Ok(AudioStream { input })
    }

    fn should_create_async(&self) -> bool {
        true
    }

    // SEE: issue #186
    // Below is removed due to issues with:
    // 1) deadlocks on small files.
    // 2) serde_aux poorly handles missing field names.
    //

    // Probes for metadata about this audio file using `ffprobe`.
    // async fn aux_metadata(&mut self) -> Result<AuxMetadata, AudioStreamError> {
    //     let args = [
    //         "-v",
    //         "quiet",
    //         "-of",
    //         "json",
    //         "-show_format",
    //         "-show_streams",
    //         "-i",
    //     ];

    //     let mut output = Command::new("ffprobe")
    //         .args(args)
    //         .arg(self.path.as_ref().as_os_str())
    //         .output()
    //         .await
    //         .map_err(|e| AudioStreamError::Fail(Box::new(e)))?;

    //     AuxMetadata::from_ffprobe_json(&mut output.stdout[..])
    //         .map_err(|e| AudioStreamError::Fail(Box::new(e)))
    // }
}
