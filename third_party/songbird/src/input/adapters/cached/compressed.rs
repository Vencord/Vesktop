use super::{compressed_cost_per_sec, default_config, CodecCacheError, ToAudioBytes};
use crate::{
    constants::*,
    input::{
        codecs::{dca::*, get_codec_registry, get_probe},
        AudioStream,
        Input,
        LiveInput,
    },
};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use opus2::{Application, Bitrate, Channels, Encoder as OpusEncoder, ErrorCode as OpusErrorCode};
use std::{
    io::{
        Cursor,
        Error as IoError,
        ErrorKind as IoErrorKind,
        Read,
        Result as IoResult,
        Seek,
        SeekFrom,
    },
    mem,
    sync::atomic::{AtomicUsize, Ordering},
};
use streamcatcher::{
    Config as ScConfig,
    NeedsBytes,
    Stateful,
    Transform,
    TransformPosition,
    TxCatcher,
};
use symphonia_core::{
    audio::Channels as SChannels,
    codecs::CodecRegistry,
    io::MediaSource,
    meta::{MetadataRevision, StandardTagKey, Value},
    probe::{Probe, ProbedMetadata},
};
use tracing::{debug, trace};

/// Configuration for a cached source.
pub struct Config {
    /// Registry of audio codecs supported by the driver.
    ///
    /// Defaults to [`get_codec_registry`], which adds opus2-based Opus codec support
    /// to all of Symphonia's default codecs.
    pub codec_registry: &'static CodecRegistry,
    /// Registry of the muxers and container formats supported by the driver.
    ///
    /// Defaults to [`get_probe`], which includes all of Symphonia's default format handlers
    /// and DCA format support.
    pub format_registry: &'static Probe,
    /// Configuration for the inner streamcatcher instance.
    ///
    /// Notably, this governs size hints and resize logic.
    pub streamcatcher: ScConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            codec_registry: get_codec_registry(),
            format_registry: get_probe(),
            streamcatcher: ScConfig::default(),
        }
    }
}

impl Config {
    /// Generate a storage configuration given an estimated storage bitrate
    /// `cost_per_sec` in bytes/s.
    #[must_use]
    pub fn default_from_cost(cost_per_sec: usize) -> Self {
        let streamcatcher = default_config(cost_per_sec);
        Self {
            streamcatcher,
            ..Default::default()
        }
    }
}

/// A wrapper around an existing [`Input`] which compresses
/// the input using the Opus codec before storing it in memory.
///
/// The main purpose of this wrapper is to enable seeking on
/// incompatible sources and to ease resource consumption for
/// commonly reused/shared tracks. If only one Opus-compressed track
/// is playing at a time, then this removes the runtime decode cost
/// from the driver.
///
/// This is intended for use with larger, repeatedly used audio
/// tracks shared between sources, and stores the sound data
/// retrieved as **compressed Opus audio**.
///
/// Internally, this stores the stream and its metadata as a DCA1 file,
/// which can be written out to disk for later use.
///
/// [`Input`]: crate::input::Input
#[derive(Clone)]
pub struct Compressed {
    /// Inner shared bytestore.
    pub raw: TxCatcher<ToAudioBytes, OpusCompressor>,
}

impl Compressed {
    /// Wrap an existing [`Input`] with an in-memory store, compressed using Opus.
    ///
    /// [`Input`]: Input
    pub async fn new(source: Input, bitrate: Bitrate) -> Result<Self, CodecCacheError> {
        Self::with_config(source, bitrate, None).await
    }

    /// Wrap an existing [`Input`] with an in-memory store, compressed using Opus, with
    /// custom configuration for both Symphonia and the backing store.
    ///
    /// [`Input`]: Input
    pub async fn with_config(
        source: Input,
        bitrate: Bitrate,
        config: Option<Config>,
    ) -> Result<Self, CodecCacheError> {
        let input = match source {
            Input::Lazy(mut r) => {
                let created = if r.should_create_async() {
                    r.create_async().await.map_err(CodecCacheError::from)
                } else {
                    tokio::task::spawn_blocking(move || r.create().map_err(CodecCacheError::from))
                        .await
                        .map_err(CodecCacheError::from)
                        .and_then(|v| v)
                };

                created.map(LiveInput::Raw)
            },
            Input::Live(LiveInput::Parsed(_), _) => Err(CodecCacheError::StreamNotAtStart),
            Input::Live(a, _rec) => Ok(a),
        }?;

        let cost_per_sec = compressed_cost_per_sec(bitrate);
        let config = config.unwrap_or_else(|| Config::default_from_cost(cost_per_sec));

        let promoted = tokio::task::spawn_blocking(move || {
            input.promote(config.codec_registry, config.format_registry)
        })
        .await??;

        // If success, guaranteed to be Parsed
        let LiveInput::Parsed(mut parsed) = promoted else {
            unreachable!()
        };

        // TODO: apply length hint.
        // if config.length_hint.is_none() {
        //     if let Some(dur) = metadata.duration {
        //         apply_length_hint(&mut config, dur, cost_per_sec);
        //     }
        // }

        let track_info = parsed.decoder.codec_params();
        let chan_count = track_info.channels.map_or(2, SChannels::count);

        let (channels, stereo) = if chan_count >= 2 {
            (Channels::Stereo, true)
        } else {
            (Channels::Mono, false)
        };

        let mut encoder = OpusEncoder::new(48000, channels, Application::Audio)?;
        encoder.set_bitrate(bitrate)?;

        let codec_type = parsed.decoder.codec_params().codec;
        let encoding = config
            .codec_registry
            .get_codec(codec_type)
            .map(|v| v.short_name.to_string());

        let format_meta_hold = parsed.format.metadata();
        let format_meta = format_meta_hold.current();

        let metadata = create_metadata(
            &mut parsed.meta,
            format_meta,
            &mut encoder,
            chan_count as u8,
            encoding,
        )?;
        let mut metabytes = b"DCA1\0\0\0\0".to_vec();
        let orig_len = metabytes.len();
        serde_json::to_writer(&mut metabytes, &metadata)?;
        let meta_len = (metabytes.len() - orig_len)
            .try_into()
            .map_err(|_| CodecCacheError::MetadataTooLarge)?;

        (&mut metabytes[4..][..mem::size_of::<i32>()])
            .write_i32::<LittleEndian>(meta_len)
            .expect("Magic byte writing location guaranteed to be well-founded.");

        let source = ToAudioBytes::new(parsed, Some(2));

        let raw = config
            .streamcatcher
            .build_tx(source, OpusCompressor::new(encoder, stereo, metabytes))?;

        Ok(Self { raw })
    }

    /// Acquire a new handle to this object, creating a new
    /// view of the existing cached data from the beginning.
    #[must_use]
    pub fn new_handle(&self) -> Self {
        Self {
            raw: self.raw.new_handle(),
        }
    }
}

fn create_metadata(
    probe_metadata: &mut ProbedMetadata,
    track_metadata: Option<&MetadataRevision>,
    opus: &mut OpusEncoder,
    channels: u8,
    encoding: Option<String>,
) -> Result<DcaMetadata, CodecCacheError> {
    let dca = DcaInfo {
        version: 1,
        tool: Tool {
            name: env!("CARGO_PKG_NAME").into(),
            version: env!("CARGO_PKG_VERSION").into(),
            url: Some(env!("CARGO_PKG_HOMEPAGE").into()),
            author: Some(env!("CARGO_PKG_AUTHORS").into()),
        },
    };

    let abr = match opus.get_bitrate()? {
        Bitrate::Bits(i) => Some(i as u64),
        Bitrate::Auto => None,
        Bitrate::Max => Some(510_000),
    };

    let mode = match opus.get_application()? {
        Application::Voip => "voip",
        Application::Audio => "music",
        Application::LowDelay => "lowdelay",
    }
    .to_string();

    let sample_rate = opus.get_sample_rate()?;

    let opus = Opus {
        mode,
        sample_rate,
        frame_size: MONO_FRAME_BYTE_SIZE as u64,
        abr,
        vbr: opus.get_vbr()?,
        channels: channels.min(2),
    };

    let mut origin = Origin {
        source: Some("file".into()),
        abr: None,
        channels: Some(channels),
        encoding,
        url: None,
    };

    let mut info = Info {
        title: None,
        artist: None,
        album: None,
        genre: None,
        cover: None,
        comments: None,
    };

    if let Some(meta) = probe_metadata.get() {
        apply_meta_to_dca(&mut info, &mut origin, meta.current());
    }

    apply_meta_to_dca(&mut info, &mut origin, track_metadata);

    Ok(DcaMetadata {
        dca,
        opus,
        info: Some(info),
        origin: Some(origin),
        extra: None,
    })
}

fn apply_meta_to_dca(info: &mut Info, origin: &mut Origin, src_meta: Option<&MetadataRevision>) {
    if let Some(meta) = src_meta {
        for tag in meta.tags() {
            match tag.std_key {
                Some(StandardTagKey::Album) =>
                    if let Value::String(s) = &tag.value {
                        info.album = Some(s.clone());
                    },
                Some(StandardTagKey::Artist) =>
                    if let Value::String(s) = &tag.value {
                        info.artist = Some(s.clone());
                    },
                Some(StandardTagKey::Comment) =>
                    if let Value::String(s) = &tag.value {
                        info.comments = Some(s.clone());
                    },
                Some(StandardTagKey::Genre) =>
                    if let Value::String(s) = &tag.value {
                        info.genre = Some(s.clone());
                    },
                Some(StandardTagKey::TrackTitle) =>
                    if let Value::String(s) = &tag.value {
                        info.title = Some(s.clone());
                    },
                Some(StandardTagKey::Url | StandardTagKey::UrlSource) => {
                    if let Value::String(s) = &tag.value {
                        origin.url = Some(s.clone());
                    }
                },
                _ => {},
            }
        }

        for _visual in meta.visuals() {
            // FIXME: will require MIME type inspection and Base64 conversion.
        }
    }
}

/// Transform applied inside [`Compressed`], converting a floating-point PCM
/// input stream into a DCA-framed Opus stream.
///
/// Created and managed by [`Compressed`].
///
/// [`Compressed`]: Compressed
#[derive(Debug)]
pub struct OpusCompressor {
    prepend: Option<Cursor<Vec<u8>>>,
    encoder: OpusEncoder,
    last_frame: Vec<u8>,
    stereo_input: bool,
    frame_pos: usize,
    audio_bytes: AtomicUsize,
}

impl OpusCompressor {
    fn new(encoder: OpusEncoder, stereo_input: bool, prepend: Vec<u8>) -> Self {
        Self {
            prepend: Some(Cursor::new(prepend)),
            encoder,
            last_frame: Vec::with_capacity(4000),
            stereo_input,
            frame_pos: 0,
            audio_bytes: AtomicUsize::default(),
        }
    }
}

impl<T> Transform<T> for OpusCompressor
where
    T: Read,
{
    fn transform_read(&mut self, src: &mut T, buf: &mut [u8]) -> IoResult<TransformPosition> {
        if let Some(prepend) = self.prepend.as_mut() {
            match prepend.read(buf)? {
                0 => {},
                n => return Ok(TransformPosition::Read(n)),
            }
        }

        self.prepend = None;

        let output_start = mem::size_of::<u16>();
        let mut eof = false;

        let mut raw_len = 0;
        let mut out = None;
        let mut sample_buf = [0f32; STEREO_FRAME_SIZE];
        let (samples_in_frame, interleaved_count) = if self.stereo_input {
            (STEREO_FRAME_SIZE, 2)
        } else {
            (MONO_FRAME_SIZE, 1)
        };

        // Purge old frame and read new, if needed.
        if self.frame_pos == self.last_frame.len() + output_start || self.last_frame.is_empty() {
            self.last_frame.resize(self.last_frame.capacity(), 0);

            // We can't use `read_f32_into` because we can't guarantee the buffer will be filled.
            // However, we can guarantee that reads will be channel aligned at least!
            for el in sample_buf[..samples_in_frame].chunks_mut(interleaved_count) {
                match src.read_f32_into::<LittleEndian>(el) {
                    Ok(()) => {
                        raw_len += interleaved_count;
                    },
                    Err(e) if e.kind() == IoErrorKind::UnexpectedEof => {
                        eof = true;
                        break;
                    },
                    Err(e) => {
                        out = Some(Err(e));
                        break;
                    },
                }
            }

            if out.is_none() && raw_len > 0 {
                loop {
                    // NOTE: we don't index by raw_len because the last frame can be too small
                    // to occupy a "whole packet". Zero-padding is the correct behaviour.
                    match self
                        .encoder
                        .encode_float(&sample_buf[..samples_in_frame], &mut self.last_frame[..])
                    {
                        Ok(pkt_len) => {
                            trace!("Next packet to write has {:?}", pkt_len);
                            self.frame_pos = 0;
                            self.last_frame.truncate(pkt_len);
                            break;
                        },
                        Err(e) if e.code() == OpusErrorCode::BufferTooSmall => {
                            // If we need more capacity to encode this frame, then take it.
                            trace!("Resizing inner buffer (+256).");
                            self.last_frame.resize(self.last_frame.len() + 256, 0);
                        },
                        Err(e) => {
                            debug!("Read error {:?} {:?} {:?}.", e, out, raw_len);
                            out = Some(Err(IoError::other(e)));
                            break;
                        },
                    }
                }
            }
        }

        if out.is_none() {
            // Write from frame we have.
            let start = if self.frame_pos < output_start {
                (&mut buf[..output_start])
                    .write_i16::<LittleEndian>(self.last_frame.len() as i16)
                    .expect(
                        "Minimum bytes requirement for Opus (2) should mean that an i16 \
                             may always be written.",
                    );
                self.frame_pos += output_start;

                trace!("Wrote frame header: {}.", self.last_frame.len());

                output_start
            } else {
                0
            };

            let out_pos = self.frame_pos - output_start;
            let remaining = self.last_frame.len() - out_pos;
            let write_len = remaining.min(buf.len() - start);
            buf[start..start + write_len]
                .copy_from_slice(&self.last_frame[out_pos..out_pos + write_len]);
            self.frame_pos += write_len;
            trace!("Appended {} to inner store", write_len);
            out = Some(Ok(write_len + start));
        }

        // NOTE: use of raw_len here preserves true sample length even if
        // stream is extended to 20ms boundary.
        out.unwrap_or_else(|| Err(IoError::other("Unclear.")))
            .map(|compressed_sz| {
                self.audio_bytes
                    .fetch_add(raw_len * mem::size_of::<f32>(), Ordering::Release);

                if eof {
                    TransformPosition::Finished
                } else {
                    TransformPosition::Read(compressed_sz)
                }
            })
    }
}

impl NeedsBytes for OpusCompressor {
    fn min_bytes_required(&self) -> usize {
        2
    }
}

impl Stateful for OpusCompressor {
    type State = usize;

    fn state(&self) -> Self::State {
        self.audio_bytes.load(Ordering::Acquire)
    }
}

impl Read for Compressed {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        self.raw.read(buf)
    }
}

impl Seek for Compressed {
    fn seek(&mut self, pos: SeekFrom) -> IoResult<u64> {
        self.raw.seek(pos)
    }
}

impl MediaSource for Compressed {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        if self.raw.is_finished() {
            Some(self.raw.len() as u64)
        } else {
            None
        }
    }
}

impl From<Compressed> for Input {
    fn from(val: Compressed) -> Input {
        let input = Box::new(val);
        Input::Live(LiveInput::Raw(AudioStream { input }), None)
    }
}
