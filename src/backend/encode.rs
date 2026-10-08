//! Go Live encoder (docs/SCREENSHARE.md): the latest captured
//! frame, scaled to fit 1280x720, through openh264 at 30 fps. openh264 isn't
//! `Send`, so it owns a thread; encoded Annex-B frames go to the stream
//! task with their 90 kHz timestamp.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use openh264::OpenH264API;
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, UsageType,
};
use openh264::formats::{BgraSliceU8, RgbaSliceU8, YUVBuffer};

use crate::backend::capture::{Frame, Shared};

/// What op 12 announces: the stream server holds us to it.
pub const MAX_WIDTH: u32 = 1280;
pub const MAX_HEIGHT: u32 = 720;
pub const FPS: u32 = 30;
pub const BITRATE: u32 = 2_500_000;

/// One encoded access unit and its RTP timestamp.
pub type Encoded = (Vec<u8>, u32);

/// Encodes until the receiver is dropped. Setting `keyframe` makes the
/// next frame an IDR (viewer PLI, DAVE becoming ready).
pub fn spawn(
    frames: Shared,
    keyframe: Arc<AtomicBool>,
) -> Result<tokio::sync::mpsc::Receiver<Encoded>, String> {
    // Two frames of slack: a stalled sender drops frames, never queues them.
    let (tx, rx) = tokio::sync::mpsc::channel(2);
    std::thread::Builder::new()
        .name("fastdiscord-h264-enc".into())
        .spawn(move || {
            let started = Instant::now();
            let period = Duration::from_secs(1) / FPS;
            let mut encoder: Option<(Encoder, (u32, u32))> = None;
            let mut next = Instant::now();
            while !tx.is_closed() {
                next += period;
                std::thread::sleep(next.saturating_duration_since(Instant::now()));
                // Static screens deliver no new frames: re-encode the last
                // one, which openh264 turns into tiny skip frames.
                let Some(frame) = frames.lock().unwrap().clone() else {
                    continue;
                };
                let (width, height, pixels) = fit(&frame, MAX_WIDTH, MAX_HEIGHT);
                if encoder.as_ref().is_none_or(|(_, size)| *size != (width, height)) {
                    // Diagnostic: an all-black source would explain tiny IDRs.
                    let mean = pixels.iter().step_by(97).map(|&b| u64::from(b)).sum::<u64>()
                        / (pixels.len() as u64 / 97).max(1);
                    log::info!(
                        "transmissão: encoder {width}x{height} (captura {}x{}, bgr={}, média {mean})",
                        frame.width,
                        frame.height,
                        frame.bgr
                    );
                    match new_encoder() {
                        Ok(new) => encoder = Some((new, (width, height))),
                        Err(err) => return log::warn!("transmissão: encoder H264: {err}"),
                    }
                }
                let Some((encoder, _)) = encoder.as_mut() else {
                    continue;
                };
                if keyframe.swap(false, Ordering::Relaxed) {
                    encoder.force_intra_frame();
                }
                let dims = (width as usize, height as usize);
                let yuv = if frame.bgr {
                    YUVBuffer::from_rgb_source(BgraSliceU8::new(&pixels, dims))
                } else {
                    YUVBuffer::from_rgb_source(RgbaSliceU8::new(&pixels, dims))
                };
                let annex_b = match encoder.encode(&yuv) {
                    Ok(bitstream) => bitstream.to_vec(),
                    Err(err) => {
                        log::debug!("transmissão: encode falhou: {err}");
                        continue;
                    }
                };
                if annex_b.is_empty() {
                    continue;
                }
                // IDRs (NAL type 5) are what viewers start from: log them.
                if crate::backend::rtp::split_annex_b(&annex_b).iter().any(|nal| nal[0] & 0x1F == 5) {
                    log::info!("transmissão: IDR de {} bytes", annex_b.len());
                }
                let timestamp = (started.elapsed().as_micros() * 9 / 100) as u32;
                // Full = the task is behind; dropping beats piling up delay.
                let _ = tx.try_send((annex_b, timestamp));
            }
        })
        .map_err(|err| format!("thread do encoder: {err}"))?;
    Ok(rx)
}

fn new_encoder() -> Result<Encoder, openh264::Error> {
    let config = EncoderConfig::new()
        .usage_type(UsageType::ScreenContentRealTime)
        .bitrate(BitRate::from_bps(BITRATE))
        .max_frame_rate(FrameRate::from_hz(FPS as f32))
        // An IDR every 2 s lets late viewers in even if their PLI is lost.
        .intra_frame_period(IntraFramePeriod::from_num_frames(2 * FPS));
    Encoder::with_api_config(OpenH264API::from_source(), config)
}

/// Nearest-neighbour downscale (never up) to fit `max_w`x`max_h`, with even
/// dimensions for 4:2:0; keeps the frame's channel order.
fn fit(frame: &Frame, max_w: u32, max_h: u32) -> (u32, u32, Vec<u8>) {
    let scale = (f64::from(max_w) / f64::from(frame.width))
        .min(f64::from(max_h) / f64::from(frame.height))
        .min(1.0);
    let width = ((f64::from(frame.width) * scale) as u32 & !1).max(2);
    let height = ((f64::from(frame.height) * scale) as u32 & !1).max(2);
    let columns: Vec<usize> = (0..width)
        .map(|x| (u64::from(x) * u64::from(frame.width) / u64::from(width)) as usize * 4)
        .collect();
    let mut out = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        let source_y = (u64::from(y) * u64::from(frame.height) / u64::from(height)) as usize;
        let row = &frame.pixels[source_y * frame.width as usize * 4..][..frame.width as usize * 4];
        for &x in &columns {
            out.extend_from_slice(&row[x..x + 4]);
        }
    }
    (width, height, out)
}

#[cfg(test)]
mod tests {
    use super::fit;
    use crate::backend::capture::Frame;

    #[test]
    fn fit_downscales_to_even_size_and_never_upscales() {
        // 4x2 frame, pixel value = x + 10*y.
        let pixels = (0..2u8).flat_map(|y| (0..4u8).flat_map(move |x| [x + 10 * y; 4])).collect();
        let frame = Frame { width: 4, height: 2, pixels, bgr: true, seq: 1 };
        let (w, h, out) = fit(&frame, 2, 2);
        assert_eq!((w, h), (2, 2));
        let firsts: Vec<u8> = out.chunks(4).map(|px| px[0]).collect();
        assert_eq!(firsts, [0, 2, 10, 12]);
        assert_eq!(fit(&frame, 1280, 720).0, 4);
    }
}
