use std::io::{Seek, SeekFrom};
use symphonia::core::{
    audio::Channels,
    codecs::{CodecParameters, CODEC_TYPE_PCM_F32LE},
    errors::{self as symph_err, Result as SymphResult, SeekErrorKind},
    formats::prelude::*,
    io::{MediaSource, MediaSourceStream, ReadBytes, SeekBuffered},
    meta::{Metadata as SymphMetadata, MetadataLog},
    probe::{Descriptor, Instantiate, QueryDescriptor},
};

impl QueryDescriptor for RawReader {
    fn query() -> &'static [Descriptor] {
        &[symphonia_core::support_format!(
            "raw",
            "Raw arbitrary-length f32 audio container.",
            &["rawf32"],
            &[],
            &[b"SbirdRaw"]
        )]
    }

    fn score(_context: &[u8]) -> u8 {
        255
    }
}

/// Symphonia support for a simple container for raw f32-PCM data of unknown duration.
///
/// Contained files have a simple header:
/// * the 8-byte signature `b"SbirdRaw"`,
/// * the sample rate, as a little-endian `u32`,
/// * the channel count, as a little-endian `u32`.
///
/// The remainder of the file is interleaved little-endian `f32` samples.
pub struct RawReader {
    source: MediaSourceStream,
    track: Track,
    meta: MetadataLog,
    curr_ts: TimeStamp,
    max_ts: Option<TimeStamp>,
}

impl FormatReader for RawReader {
    fn try_new(mut source: MediaSourceStream, _options: &FormatOptions) -> SymphResult<Self> {
        let mut magic = [0u8; 8];
        ReadBytes::read_buf_exact(&mut source, &mut magic[..])?;

        if &magic != b"SbirdRaw" {
            source.seek_buffered_rel(-(magic.len() as isize));
            return symph_err::decode_error("rawf32: illegal magic byte sequence.");
        }

        let sample_rate = source.read_u32()?;
        let n_chans = source.read_u32()?;

        let chans = match n_chans {
            1 => Channels::FRONT_LEFT,
            2 => Channels::FRONT_LEFT | Channels::FRONT_RIGHT,
            _ =>
                return symph_err::decode_error(
                    "rawf32: channel layout is not stereo or mono for fmt_pcm",
                ),
        };

        let mut codec_params = CodecParameters::new();

        codec_params
            .for_codec(CODEC_TYPE_PCM_F32LE)
            .with_bits_per_coded_sample((std::mem::size_of::<f32>() as u32) * 8)
            .with_bits_per_sample((std::mem::size_of::<f32>() as u32) * 8)
            .with_sample_rate(sample_rate)
            .with_time_base(TimeBase::new(1, sample_rate))
            .with_sample_format(symphonia_core::sample::SampleFormat::F32)
            .with_max_frames_per_packet(sample_rate as u64 / 50)
            .with_channels(chans);

        Ok(Self {
            source,
            track: Track {
                id: 0,
                language: None,
                codec_params,
            },
            meta: MetadataLog::default(),
            curr_ts: 0,
            max_ts: None,
        })
    }

    fn cues(&self) -> &[Cue] {
        &[]
    }

    fn metadata(&mut self) -> SymphMetadata<'_> {
        self.meta.metadata()
    }

    fn seek(&mut self, _mode: SeekMode, to: SeekTo) -> SymphResult<SeekedTo> {
        let can_backseek = self.source.is_seekable();

        let track = &self.track;
        let rate = track.codec_params.sample_rate;
        let ts = match to {
            SeekTo::Time { time, .. } =>
                if let Some(rate) = rate {
                    TimeBase::new(1, rate).calc_timestamp(time)
                } else {
                    return symph_err::seek_error(SeekErrorKind::Unseekable);
                },
            SeekTo::TimeStamp { ts, .. } => ts,
        };

        if let Some(max_ts) = self.max_ts {
            if ts > max_ts {
                return symph_err::seek_error(SeekErrorKind::OutOfRange);
            }
        }

        let backseek_needed = self.curr_ts > ts;

        if backseek_needed && !can_backseek {
            return symph_err::seek_error(SeekErrorKind::ForwardOnly);
        }

        let chan_count = track
            .codec_params
            .channels
            .expect("Channel count is built into format.")
            .count() as u64;

        let seek_pos = 16 + (std::mem::size_of::<f32>() as u64) * (ts * chan_count);

        self.source.seek(SeekFrom::Start(seek_pos))?;
        self.curr_ts = ts;

        Ok(SeekedTo {
            track_id: track.id,
            required_ts: ts,
            actual_ts: ts,
        })
    }

    fn tracks(&self) -> &[Track] {
        std::slice::from_ref(&self.track)
    }

    fn default_track(&self) -> Option<&Track> {
        Some(&self.track)
    }

    fn next_packet(&mut self) -> SymphResult<Packet> {
        let track = &self.track;
        let rate = track
            .codec_params
            .sample_rate
            .expect("Sample rate is built into format.") as usize;

        let chan_count = track
            .codec_params
            .channels
            .expect("Channel count is built into format.")
            .count();

        let sample_unit = std::mem::size_of::<f32>() * chan_count;

        // Aim for 20ms (50Hz).
        let buf = self.source.read_boxed_slice((rate / 50) * sample_unit)?;

        let sample_ct = (buf.len() / sample_unit) as u64;
        let out = Packet::new_from_boxed_slice(0, self.curr_ts, sample_ct, buf);

        self.curr_ts += sample_ct;

        Ok(out)
    }

    fn into_inner(self: Box<Self>) -> MediaSourceStream {
        self.source
    }
}
