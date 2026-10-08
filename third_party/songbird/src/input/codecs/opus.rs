use crate::constants::*;
use opus2::{Channels, Decoder as Opus2Decoder, ErrorCode};
use symphonia_core::{
    audio::{AsAudioBufferRef, AudioBuffer, AudioBufferRef, Layout, Signal, SignalSpec},
    codecs::{
        CodecDescriptor,
        CodecParameters,
        Decoder,
        DecoderOptions,
        FinalizeResult,
        CODEC_TYPE_OPUS,
    },
    errors::{decode_error, Result as SymphResult},
    formats::Packet,
};

/// Opus decoder for symphonia, based on libopus v1.5 (via [`opus2`]).
pub struct OpusDecoder {
    inner: Opus2Decoder,
    params: CodecParameters,
    buf: AudioBuffer<f32>,
    rawbuf: Vec<f32>,
}

/// # SAFETY
/// The underlying Opus decoder (currently) requires only a `&self` parameter
/// to decode given packets, which is likely a mistaken decision.
///
/// This struct makes stronger assumptions and only touches FFI decoder state with a
/// `&mut self`, preventing data races via `&OpusDecoder` as required by `impl Sync`.
/// No access to other internal state relies on unsafety or crosses FFI.
unsafe impl Sync for OpusDecoder {}

impl OpusDecoder {
    fn decode_inner(&mut self, packet: &Packet) -> SymphResult<()> {
        let s_ct = loop {
            if packet.buf().len() > i32::MAX as usize {
                return decode_error("Opus packet was too large (greater than i32::MAX bytes).");
            }

            match self
                .inner
                .decode_float(packet.buf(), &mut self.rawbuf, false)
            {
                Ok(v) => break v,
                Err(e) if e.code() == ErrorCode::BufferTooSmall => {
                    // double the buffer size
                    // correct behav would be to mirror the decoder logic in the udp_rx set.
                    let new_size = (self.rawbuf.len() * 2).min(i32::MAX as usize);
                    if new_size == self.rawbuf.len() {
                        return decode_error("Opus frame too big: cannot expand opus frame decode buffer any further.");
                    }

                    self.rawbuf.resize(new_size, 0.0);
                    self.buf = AudioBuffer::new(
                        self.rawbuf.len() as u64 / 2,
                        SignalSpec::new_with_layout(SAMPLE_RATE_RAW as u32, Layout::Stereo),
                    );
                },
                Err(e) => {
                    tracing::error!("Opus decode error: {:?}", e);
                    return decode_error("Opus decode error: see 'tracing' logs.");
                },
            }
        };

        self.buf.clear();
        self.buf.render_reserved(Some(s_ct));

        // Forcibly assuming stereo, for now.
        for ch in 0..2 {
            let iter = self.rawbuf.chunks_exact(2).map(|chunk| chunk[ch]);
            for (tgt, src) in self.buf.chan_mut(ch).iter_mut().zip(iter) {
                *tgt = src;
            }
        }

        Ok(())
    }
}

impl Decoder for OpusDecoder {
    fn try_new(params: &CodecParameters, _options: &DecoderOptions) -> SymphResult<Self> {
        let inner = Opus2Decoder::new(SAMPLE_RATE, Channels::Stereo).unwrap();

        let mut params = params.clone();
        params.with_sample_rate(SAMPLE_RATE_RAW as u32);

        Ok(Self {
            inner,
            params,
            buf: AudioBuffer::new(
                MONO_FRAME_SIZE as u64,
                SignalSpec::new_with_layout(SAMPLE_RATE_RAW as u32, Layout::Stereo),
            ),
            rawbuf: vec![0.0f32; STEREO_FRAME_SIZE],
        })
    }

    fn supported_codecs() -> &'static [CodecDescriptor] {
        &[symphonia_core::support_codec!(
            CODEC_TYPE_OPUS,
            "opus",
            "libopus (1.5+, opus2)"
        )]
    }

    fn codec_params(&self) -> &CodecParameters {
        &self.params
    }

    fn decode(&mut self, packet: &Packet) -> SymphResult<AudioBufferRef<'_>> {
        if let Err(e) = self.decode_inner(packet) {
            self.buf.clear();
            Err(e)
        } else {
            Ok(self.buf.as_audio_buffer_ref())
        }
    }

    fn reset(&mut self) {
        _ = self.inner.reset_state();
    }

    fn finalize(&mut self) -> FinalizeResult {
        FinalizeResult::default()
    }

    fn last_decoded(&self) -> AudioBufferRef<'_> {
        self.buf.as_audio_buffer_ref()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        constants::test_data::FILE_WEBM_TARGET,
        input::{input_tests::*, File},
    };

    // NOTE: this covers youtube audio in a non-copyright-violating way, since
    // those depend on an HttpRequest internally anyhow.
    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn webm_track_plays() {
        track_plays_passthrough(|| File::new(FILE_WEBM_TARGET)).await;
    }

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn webm_forward_seek_correct() {
        forward_seek_correct(|| File::new(FILE_WEBM_TARGET)).await;
    }

    #[tokio::test]
    #[ntest::timeout(10_000)]
    async fn webm_backward_seek_correct() {
        backward_seek_correct(|| File::new(FILE_WEBM_TARGET)).await;
    }
}
