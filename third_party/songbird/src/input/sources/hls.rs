use async_trait::async_trait;
use bytes::Bytes;
use futures::StreamExt;
use reqwest::{header::HeaderMap, Client};
use stream_lib::Event;
use symphonia_core::io::MediaSource;
use tokio_util::io::StreamReader;

use crate::input::{
    AsyncAdapterStream,
    AsyncReadOnlySource,
    AudioStream,
    AudioStreamError,
    Compose,
    Input,
};

/// Lazy HLS stream
///
/// # Note:
///
/// `Compose::create` for this struct panics if called outside of a
/// tokio executor since it uses background tasks.
#[derive(Debug)]
pub struct HlsRequest {
    /// HTTP client
    client: Client,
    /// URL of hls playlist
    request: String,
    /// Headers of the request
    headers: HeaderMap,
}

impl HlsRequest {
    #[must_use]
    /// Create a lazy HLS request.
    pub fn new(client: Client, request: String) -> Self {
        Self::new_with_headers(client, request, HeaderMap::default())
    }

    #[must_use]
    /// Create a lazy HTTP request.
    pub fn new_with_headers(client: Client, request: String, headers: HeaderMap) -> Self {
        HlsRequest {
            client,
            request,
            headers,
        }
    }

    fn create_stream(&mut self) -> Result<AsyncReadOnlySource, AudioStreamError> {
        let request = self
            .client
            .get(&self.request)
            .headers(self.headers.clone())
            .build()
            .map_err(|why| AudioStreamError::Fail(why.into()))?;

        let hls = stream_lib::download_hls(self.client.clone(), request, None);

        let stream = Box::new(StreamReader::new(hls.map(|ev| match ev {
            Event::Bytes { bytes } => Ok(bytes),
            Event::End => Ok(Bytes::new()),
            Event::Error { error } => Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                error,
            )),
        })));

        Ok(AsyncReadOnlySource { stream })
    }
}

#[async_trait]
impl Compose for HlsRequest {
    fn create(&mut self) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        self.create_stream().map(|input| {
            let stream = AsyncAdapterStream::new(Box::new(input), 64 * 1024);

            AudioStream {
                input: Box::new(stream) as Box<dyn MediaSource>,
            }
        })
    }

    async fn create_async(
        &mut self,
    ) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        self.create()
    }

    fn should_create_async(&self) -> bool {
        true
    }
}

impl From<HlsRequest> for Input {
    fn from(val: HlsRequest) -> Self {
        Input::Lazy(Box::new(val))
    }
}
