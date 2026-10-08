use crate::input::{AudioStream, Input, LiveInput};
use byteorder::{LittleEndian, WriteBytesExt};
use std::io::{ErrorKind as IoErrorKind, Read, Result as IoResult, Seek, SeekFrom, Write};
use symphonia::core::io::MediaSource;

// format header is a magic string, followed by two LE u32s (sample rate, channel count)
const FMT_HEADER: &[u8; 16] = b"SbirdRaw\0\0\0\0\0\0\0\0";

/// Adapter around a raw, interleaved, `f32` PCM byte stream.
///
/// This may be used to port legacy songbird audio sources to be compatible with
/// the symphonia backend, particularly those with unknown length (making WAV
/// unsuitable).
///
/// The format is described in [`RawReader`].
///
/// [`RawReader`]: crate::input::codecs::RawReader
pub struct RawAdapter<A> {
    prepend: [u8; 16],
    inner: A,
    pos: u64,
}

impl<A: MediaSource> RawAdapter<A> {
    /// Wrap an input PCM byte source to be readable by symphonia.
    pub fn new(audio_source: A, sample_rate: u32, channel_count: u32) -> Self {
        let mut prepend: [u8; 16] = *FMT_HEADER;
        let mut write_space = &mut prepend[8..];

        write_space
            .write_u32::<LittleEndian>(sample_rate)
            .expect("Prepend buffer is sized to include enough space for sample rate.");
        write_space
            .write_u32::<LittleEndian>(channel_count)
            .expect("Prepend buffer is sized to include enough space for number of channels.");

        Self {
            prepend,
            inner: audio_source,
            pos: 0,
        }
    }
}

impl<A: MediaSource> Read for RawAdapter<A> {
    fn read(&mut self, mut buf: &mut [u8]) -> IoResult<usize> {
        let out = if self.pos < self.prepend.len() as u64 {
            let upos = self.pos as usize;
            let remaining = self.prepend.len() - upos;
            let to_write = buf.len().min(remaining);

            buf.write(&self.prepend[upos..][..to_write])
        } else {
            self.inner.read(buf)
        };

        if let Ok(n) = out {
            self.pos += n as u64;
        }

        out
    }
}

impl<A: MediaSource> Seek for RawAdapter<A> {
    fn seek(&mut self, pos: SeekFrom) -> IoResult<u64> {
        if self.is_seekable() {
            let target_pos = match pos {
                SeekFrom::Start(p) => p,
                SeekFrom::End(_) => return Err(IoErrorKind::Unsupported.into()),
                SeekFrom::Current(p) if p.unsigned_abs() > self.pos =>
                    return Err(IoErrorKind::InvalidInput.into()),
                SeekFrom::Current(p) => (self.pos as i64 + p) as u64,
            };

            let out = if target_pos as usize <= self.prepend.len() {
                self.inner.rewind().map(|()| 0)
            } else {
                self.inner.seek(SeekFrom::Start(target_pos))
            };

            match out {
                Ok(0) => self.pos = target_pos,
                Ok(a) => self.pos = a + self.prepend.len() as u64,
                _ => {},
            }

            out.map(|_| self.pos)
        } else {
            Err(IoErrorKind::Unsupported.into())
        }
    }
}

impl<A: MediaSource> MediaSource for RawAdapter<A> {
    fn is_seekable(&self) -> bool {
        self.inner.is_seekable()
    }

    fn byte_len(&self) -> Option<u64> {
        self.inner.byte_len().map(|m| m + self.prepend.len() as u64)
    }
}

impl<A: MediaSource + Send + Sync + 'static> From<RawAdapter<A>> for Input {
    fn from(val: RawAdapter<A>) -> Self {
        let live = LiveInput::Raw(AudioStream {
            input: Box::new(val),
        });

        Input::Live(live, None)
    }
}
