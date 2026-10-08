//! Screen capture for both share backends (docs/SCREENSHARE.md): a
//! latest-frame slot that the preview, the Go Live encoder and the WHIP
//! feeder read at their own pace. The capture itself is per platform:
//! `linux.rs` (ScreenCast portal + PipeWire), `windows.rs` (GStreamer's
//! Desktop Duplication source).

use std::sync::{Arc, Mutex};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as platform;

/// One captured frame: tightly packed 32-bit pixels, BGRx or RGBx order.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    /// Blue first (BGRx/BGRA, the usual XRGB8888 desktop format).
    pub bgr: bool,
    /// Bumps on every new frame so readers can skip ones they've seen.
    pub seq: u64,
}

impl Frame {
    /// Opaque RGBA, nearest-neighbour downscaled by an integer step so it
    /// is at most `max_width` wide: cheap enough for a per-frame preview.
    pub fn preview_rgba(&self, max_width: u32) -> ([usize; 2], Vec<u8>) {
        let step = self.width.div_ceil(max_width.max(1)).max(1) as usize;
        let (width, height) = (self.width as usize, self.height as usize);
        let (out_w, out_h) = (width.div_ceil(step), height.div_ceil(step));
        let mut out = Vec::with_capacity(out_w * out_h * 4);
        for y in (0..height).step_by(step) {
            let row = &self.pixels[y * width * 4..(y + 1) * width * 4];
            for px in row.chunks_exact(4).step_by(step) {
                if self.bgr {
                    out.extend_from_slice(&[px[2], px[1], px[0], 255]);
                } else {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
            }
        }
        ([out_w, out_h], out)
    }
}

/// The latest-frame slot.
pub type Shared = Arc<Mutex<Option<Arc<Frame>>>>;

/// A running capture. Dropping it stops the capture (and, on Linux, closes
/// the portal session).
pub struct Capture {
    /// Latest frame, shared: the preview and the encoder both read it and
    /// tell new frames apart by `seq`.
    pub frame: Shared,
    /// `seq` of the frame the preview last uploaded.
    pub preview_seq: u64,
    /// Set by the capture thread when the stream ends or fails.
    pub ended: Arc<Mutex<Option<String>>>,
    stop: Option<Box<dyn FnOnce() + Send>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop();
        }
    }
}

/// Picks a source (Linux: the portal dialog; Windows: the primary monitor)
/// and starts streaming. `on_frame` runs on the capture thread after each
/// new frame (the UI passes a repaint request). `runtime` must outlive
/// every capture: on Linux ashpd caches its D-Bus connection in a static,
/// bound to the runtime that first opened it — a per-capture runtime left
/// every later picker hanging forever.
pub fn start(runtime: tokio::runtime::Handle, on_frame: impl Fn() + Send + 'static) -> Capture {
    let frame = Arc::new(Mutex::new(None));
    let ended = Arc::new(Mutex::new(None));
    let stop = platform::start(runtime, Arc::clone(&frame), Arc::clone(&ended), on_frame);
    Capture {
        frame,
        preview_seq: 0,
        ended,
        stop: Some(stop),
    }
}

#[cfg(test)]
mod tests {
    use super::Frame;

    #[test]
    fn preview_swizzles_and_downscales() {
        // 2x2 BGRx.
        let pixels = vec![1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0];
        let frame = Frame { width: 2, height: 2, pixels, bgr: true, seq: 1 };
        let (size, rgba) = frame.preview_rgba(640);
        assert_eq!(size, [2, 2]);
        assert_eq!(rgba, [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255]);
        // Downscale keeps every 2nd pixel of every 2nd row.
        assert_eq!(frame.preview_rgba(1), ([1, 1], vec![3, 2, 1, 255]));
    }
}
