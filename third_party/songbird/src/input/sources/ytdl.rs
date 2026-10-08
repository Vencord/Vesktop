use crate::input::{
    metadata::YoutubeDlOutput,
    AudioStream,
    AudioStreamError,
    AuxMetadata,
    Compose,
    HttpRequest,
    Input,
};
use async_trait::async_trait;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client,
};
use std::{borrow::Cow, error::Error, io::ErrorKind};
use symphonia_core::io::MediaSource;
use tokio::process::Command;

use super::HlsRequest;

const YOUTUBE_DL_COMMAND: &str = "yt-dlp";

#[derive(Clone, Debug)]
enum QueryType<'a> {
    Url(Cow<'a, str>),
    Search(Cow<'a, str>),
}

impl<'a> QueryType<'a> {
    fn as_cow_str(&'a self, n_results: usize) -> Cow<'a, str> {
        match self {
            Self::Url(Cow::Owned(u)) => Cow::Borrowed(u),
            Self::Url(Cow::Borrowed(u)) => Cow::Borrowed(u),
            Self::Search(s) => Cow::Owned(format!("ytsearch{n_results}:{s}")),
        }
    }
}

/// A lazily instantiated call to download a file, finding its URL via youtube-dl.
///
/// By default, this uses yt-dlp and is backed by an [`HttpRequest`]. This handler
/// attempts to find the best audio-only source (typically `WebM`, enabling low-cost
/// Opus frame passthrough).
///
/// [`HttpRequest`]: super::HttpRequest
#[derive(Clone, Debug)]
pub struct YoutubeDl<'a> {
    program: &'a str,
    client: Client,
    metadata: Option<AuxMetadata>,
    query: QueryType<'a>,
    user_args: Vec<String>,
}

impl<'a> YoutubeDl<'a> {
    /// Creates a lazy request to select an audio stream from `url`, using "yt-dlp".
    ///
    /// This requires a reqwest client: ideally, one should be created and shared between
    /// all requests.
    #[must_use]
    pub fn new(client: Client, url: impl Into<Cow<'a, str>>) -> Self {
        Self::new_ytdl_like(YOUTUBE_DL_COMMAND, client, url)
    }

    /// Creates a lazy request to select an audio stream from `url` as in [`new`], using `program`.
    ///
    /// [`new`]: Self::new
    #[must_use]
    pub fn new_ytdl_like(program: &'a str, client: Client, url: impl Into<Cow<'a, str>>) -> Self {
        Self {
            program,
            client,
            metadata: None,
            query: QueryType::Url(url.into()),
            user_args: Vec::new(),
        }
    }

    /// Creates a request to search youtube for an optionally specified number of videos matching `query`,
    /// using "yt-dlp".
    #[must_use]
    pub fn new_search(client: Client, query: impl Into<Cow<'a, str>>) -> Self {
        Self::new_search_ytdl_like(YOUTUBE_DL_COMMAND, client, query)
    }

    /// Creates a request to search youtube for an optionally specified number of videos matching `query`,
    /// using `program`.
    #[must_use]
    pub fn new_search_ytdl_like(
        program: &'a str,
        client: Client,
        query: impl Into<Cow<'a, str>>,
    ) -> Self {
        Self {
            program,
            client,
            metadata: None,
            query: QueryType::Search(query.into()),
            user_args: Vec::new(),
        }
    }

    /// Sets additional arguments for the "yt-dlp" process
    #[must_use]
    pub fn user_args(mut self, user_args: Vec<String>) -> Self {
        self.user_args = user_args;
        self
    }

    /// Runs a search for the given query, returning a list of up to `n_results`
    /// possible matches which are `AuxMetadata` objects containing a valid URL.
    ///
    /// Returns up to 5 matches by default.
    pub async fn search(
        &mut self,
        n_results: Option<usize>,
    ) -> Result<impl Iterator<Item = AuxMetadata>, AudioStreamError> {
        let n_results = n_results.unwrap_or(5);

        Ok(self
            .query(n_results)
            .await?
            .into_iter()
            .map(|v| v.as_aux_metadata()))
    }

    /// Runs a search for the given query, returning a list of up to `n_results`
    /// possible matches.
    pub async fn query(
        &mut self,
        n_results: usize,
    ) -> Result<Vec<YoutubeDlOutput>, AudioStreamError> {
        let query_str = self.query.as_cow_str(n_results);
        let ytdl_args = [
            "-j",
            &query_str,
            "-f",
            "ba[abr>0][vcodec=none]/best",
            "--no-playlist",
        ];

        let output = Command::new(self.program)
            .args(self.user_args.clone())
            .args(ytdl_args)
            .output()
            .await
            .map_err(|e| {
                AudioStreamError::Fail(if e.kind() == ErrorKind::NotFound {
                    format!("could not find executable '{}' on path", self.program).into()
                } else {
                    Box::new(e)
                })
            })?;

        if !output.status.success() {
            return Err(AudioStreamError::Fail(
                format!(
                    "{} failed with non-zero status code: {}",
                    self.program,
                    std::str::from_utf8(&output.stderr[..]).unwrap_or("<no error message>")
                )
                .into(),
            ));
        }

        let out = output
            .stdout
            .split(|&b| b == b'\n')
            .filter(|&x| !x.is_empty())
            .map(serde_json::from_slice)
            .collect::<Result<Vec<YoutubeDlOutput>, _>>()
            .map_err(|e| AudioStreamError::Fail(Box::new(e)))?;

        let meta = out
            .first()
            .ok_or_else(|| {
                AudioStreamError::Fail(format!("no results found for '{query_str}'").into())
            })?
            .as_aux_metadata();

        self.metadata = Some(meta);

        Ok(out)
    }

    /// Get the audio stream from a [`YoutubeDlOutput`].
    pub async fn get_stream(
        &self,
        result: &YoutubeDlOutput,
    ) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        let mut headers = HeaderMap::default();

        if let Some(map) = &result.http_headers {
            headers.extend(map.iter().filter_map(|(k, v)| {
                Some((
                    HeaderName::from_bytes(k.as_bytes()).ok()?,
                    HeaderValue::from_str(v).ok()?,
                ))
            }));
        }

        #[allow(clippy::single_match_else)]
        match result.protocol.as_deref() {
            Some("m3u8_native") => {
                let mut req =
                    HlsRequest::new_with_headers(self.client.clone(), result.url.clone(), headers);
                req.create()
            },
            _ => {
                let mut req = HttpRequest {
                    client: self.client.clone(),
                    request: result.url.clone(),
                    headers,
                    content_length: result.filesize,
                };
                req.create_async().await
            },
        }
    }
}

impl From<YoutubeDl<'static>> for Input {
    fn from(val: YoutubeDl<'static>) -> Self {
        Input::Lazy(Box::new(val))
    }
}

#[async_trait]
impl Compose for YoutubeDl<'_> {
    fn create(&mut self) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        Err(AudioStreamError::Unsupported)
    }

    async fn create_async(
        &mut self,
    ) -> Result<AudioStream<Box<dyn MediaSource>>, AudioStreamError> {
        // panic safety: `query` should have ensured > 0 results if `Ok`
        let mut results = self.query(1).await?;
        let result = results.swap_remove(0);

        self.get_stream(&result).await
    }

    fn should_create_async(&self) -> bool {
        true
    }

    async fn aux_metadata(&mut self) -> Result<AuxMetadata, AudioStreamError> {
        if let Some(meta) = self.metadata.as_ref() {
            return Ok(meta.clone());
        }

        self.query(1).await?;

        self.metadata.clone().ok_or_else(|| {
            let msg: Box<dyn Error + Send + Sync + 'static> =
                "Failed to instansiate any metadata... Should be unreachable.".into();
            AudioStreamError::Fail(msg)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::test_data::*;
    use crate::input::input_tests::*;

    #[tokio::test]
    #[ntest::timeout(20_000)]
    async fn ytdl_track_plays() {
        track_plays_mixed(|| YoutubeDl::new(Client::new(), YTDL_TARGET)).await;
    }

    #[tokio::test]
    #[ignore]
    #[ntest::timeout(20_000)]
    async fn ytdl_page_with_playlist_plays() {
        track_plays_passthrough(|| YoutubeDl::new(Client::new(), YTDL_PLAYLIST_TARGET)).await;
    }

    #[tokio::test]
    #[ntest::timeout(20_000)]
    async fn ytdl_forward_seek_correct() {
        forward_seek_correct(|| YoutubeDl::new(Client::new(), YTDL_TARGET)).await;
    }

    #[tokio::test]
    #[ntest::timeout(20_000)]
    async fn ytdl_backward_seek_correct() {
        backward_seek_correct(|| YoutubeDl::new(Client::new(), YTDL_TARGET)).await;
    }

    #[tokio::test]
    #[ntest::timeout(20_000)]
    async fn fake_exe_errors() {
        let mut ytdl = YoutubeDl::new_ytdl_like("yt-dlq", Client::new(), YTDL_TARGET);

        assert!(ytdl.aux_metadata().await.is_err());
    }

    #[tokio::test]
    #[ignore]
    #[ntest::timeout(20_000)]
    async fn ytdl_search_plays() {
        let mut ytdl = YoutubeDl::new_search(Client::new(), "cloudkicker 94 days");
        let res = ytdl.search(Some(1)).await;

        let res = res.unwrap();
        assert_eq!(res.count(), 1);

        track_plays_passthrough(move || ytdl).await;
    }

    #[tokio::test]
    #[ignore]
    #[ntest::timeout(20_000)]
    async fn ytdl_search_3() {
        let mut ytdl = YoutubeDl::new_search(Client::new(), "test");
        let res = ytdl.search(Some(3)).await;

        assert_eq!(res.unwrap().count(), 3);
    }
}
