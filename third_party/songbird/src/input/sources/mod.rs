mod file;
mod hls;
mod http;
mod ytdl;

pub use self::{file::*, hls::*, http::*, ytdl::*};

use std::{
    io::{ErrorKind as IoErrorKind, Result as IoResult, SeekFrom},
    pin::Pin,
    task::{Context, Poll},
};

use async_trait::async_trait;
use pin_project::pin_project;
use tokio::io::{AsyncRead, AsyncSeek, ReadBuf};

use crate::input::{AsyncMediaSource, AudioStreamError};

/// `AsyncReadOnlySource` wraps any source implementing [`tokio::io::AsyncRead`] in an unseekable
/// [`symphonia_core::io::MediaSource`], similar to [`symphonia_core::io::ReadOnlySource`]
#[pin_project]
pub struct AsyncReadOnlySource {
    #[pin]
    stream: Box<dyn AsyncRead + Send + Sync + Unpin>,
}

impl AsyncReadOnlySource {
    /// Instantiates a new `AsyncReadOnlySource` by taking ownership and wrapping the provided
    /// `Read`er.
    pub fn new<R>(inner: R) -> Self
    where
        R: AsyncRead + Send + Sync + Unpin + 'static,
    {
        AsyncReadOnlySource {
            stream: Box::new(inner),
        }
    }

    /// Gets a reference to the underlying reader.
    #[allow(clippy::borrowed_box)] // FIXME: Changing this may break compatibility. remedy in v0.5
    #[must_use]
    pub fn get_ref(&self) -> &Box<dyn AsyncRead + Send + Sync + Unpin> {
        &self.stream
    }

    /// Unwraps this `AsyncReadOnlySource`, returning the underlying reader.
    #[must_use]
    pub fn into_inner<R>(self) -> Box<dyn AsyncRead + Send + Sync + Unpin> {
        self.stream
    }
}

impl AsyncRead for AsyncReadOnlySource {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<IoResult<()>> {
        AsyncRead::poll_read(self.project().stream, cx, buf)
    }
}

impl AsyncSeek for AsyncReadOnlySource {
    fn start_seek(self: Pin<&mut Self>, _position: SeekFrom) -> IoResult<()> {
        Err(IoErrorKind::Unsupported.into())
    }

    fn poll_complete(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<IoResult<u64>> {
        unreachable!()
    }
}

#[async_trait]
impl AsyncMediaSource for AsyncReadOnlySource {
    fn is_seekable(&self) -> bool {
        false
    }

    async fn byte_len(&self) -> Option<u64> {
        None
    }

    async fn try_resume(
        &mut self,
        _offset: u64,
    ) -> Result<Box<dyn AsyncMediaSource>, AudioStreamError> {
        Err(AudioStreamError::Unsupported)
    }
}
