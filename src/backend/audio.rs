//! Voice audio (docs/VOICE.md): the platform-neutral half — the rings
//! between the mixer and the sound card, the microphone chain (RNNoise +
//! voice-activity gate) and the `MediaSource` songbird reads. The device
//! I/O lives per platform with one API (`start`, `AudioLinks`,
//! `list_devices`): `linux.rs` through the desktop sound server
//! (PulseAudio API), `windows.rs` through WASAPI (cpal).

use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nnnoiseless::DenoiseState;
use symphonia_core::io::MediaSource;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::{AudioLinks, list_devices, start};
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{AudioLinks, list_devices, start};

/// Discord voice runs at 48 kHz.
pub const VOICE_RATE: u32 = 48_000;

/// Playback ring depth, stereo samples: ≈200 ms to absorb mixer/scheduler
/// jitter without a noticeable delay.
const OUTPUT_CAP: usize = 2 * VOICE_RATE as usize / 5;
/// Microphone ring depth, mono samples: headroom for the burst pattern
/// between the capture callback and songbird's 20 ms mixer pulls.
const INPUT_CAP: usize = VOICE_RATE as usize / 10;
/// Stereo samples (3 ticks ≈ 60 ms) to accumulate before starting playback;
/// without it, the mixer's 20 ms cadence sounds like constant crackle.
const PREBUFFER: usize = 3 * 2 * VOICE_RATE as usize / 50;
/// How long the voice-activity gate stays open after audio drops below the
/// sensitivity threshold, so word tails aren't clipped.
const VAD_HANGOVER: Duration = Duration::from_millis(300);
/// Minimum RMS that lights the speaking indicator, so it isn't stuck on
/// when the sensitivity is 0 (gate always open).
const SPEAKING_FLOOR: f32 = 0.01;

/// f32 sample ring shared by a producer (mixer or capture callback) and a
/// consumer (pulse callback or songbird's mixer). Underruns read as silence;
/// overflows drop the oldest audio.
pub struct Ring {
    samples: Mutex<VecDeque<f32>>,
    cap: usize,
}

impl Ring {
    fn new(cap: usize) -> Arc<Self> {
        Arc::new(Self {
            samples: Mutex::new(VecDeque::with_capacity(cap.min(4096))),
            cap,
        })
    }

    /// A standalone ring attached to no device: the silent microphone
    /// placeholder the driver holds between calls.
    pub fn detached() -> Arc<Self> {
        Self::new(INPUT_CAP)
    }

    /// Appends fresh audio (a finished mix tick or mic capture), dropping the
    /// oldest on overflow.
    pub fn push(&self, add: &[f32]) {
        let mut buf = self.samples.lock().unwrap();
        buf.extend(add.iter().copied());
        while buf.len() > self.cap {
            buf.pop_front();
        }
    }

    /// Pops exactly `out.len()` samples; underruns become silence.
    pub fn pop(&self, out: &mut [f32]) {
        let mut buf = self.samples.lock().unwrap();
        for slot in out.iter_mut() {
            *slot = buf.pop_front().unwrap_or(0.0);
        }
    }

    pub fn clear(&self) {
        self.samples.lock().unwrap().clear();
    }

    pub fn len(&self) -> usize {
        self.samples.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.lock().unwrap().is_empty()
    }
}


/// Microphone chain state: RNNoise, voice-activity gate, then the ring
/// songbird reads. The sound server hands us the stream spec directly —
/// 48 kHz mono f32 — so no downmix or resampling is needed here.
pub struct Capture {
    denoiser: Option<Box<DenoiseState<'static>>>,
    denoised: [f32; DenoiseState::FRAME_SIZE],
    frame: Vec<f32>,
    sensitivity: f32,
    open_until: Option<Instant>,
    ring: Arc<Ring>,
    /// Called every frame with whether we're speaking (voice.rs dedupes it
    /// into the green indicator).
    pub on_speaking: Option<Box<dyn FnMut(bool) + Send>>,
    last_log: Instant,
    peak: f32,
}

impl Capture {
    pub fn set_sensitivity(&mut self, sensitivity: u8) {
        self.sensitivity = f32::from(sensitivity) / 100.0;
    }

    /// Toggling noise suppression (re)builds the RNNoise state.
    pub fn set_noise_suppression(&mut self, on: bool) {
        if on != self.denoiser.is_some() {
            self.denoiser = on.then(DenoiseState::new);
        }
    }
}

impl Capture {
    pub fn new(sensitivity: u8, noise_suppression: bool, ring: Arc<Ring>) -> Self {
        Self {
            denoiser: noise_suppression.then(DenoiseState::new),
            denoised: [0.0; DenoiseState::FRAME_SIZE],
            frame: Vec::with_capacity(DenoiseState::FRAME_SIZE),
            sensitivity: f32::from(sensitivity) / 100.0,
            open_until: None,
            ring,
            on_speaking: None,
            last_log: Instant::now(),
            peak: 0.0,
        }
    }

    fn feed(&mut self, mono: &[f32]) {
        for &sample in mono {
            self.frame.push(sample);
            if self.frame.len() < DenoiseState::FRAME_SIZE {
                continue;
            }
            let mut frame =
                std::mem::replace(&mut self.frame, Vec::with_capacity(DenoiseState::FRAME_SIZE));
            frame.resize(DenoiseState::FRAME_SIZE, 0.0);

            // nnnoiseless works on 16-bit-scaled floats and produces
            // silence for clipped input — limit hot signals into its range.
            let denoised = self.denoiser.is_some();
            if denoised {
                let frame_rms = rms(&frame).max(0.001);
                let limiter = if frame_rms > 0.5 { 0.5 / frame_rms } else { 1.0 };
                for sample in &mut frame {
                    *sample = (*sample * limiter).clamp(-0.95, 0.95) * 32768.0;
                }
            }
            let threshold =
                self.sensitivity.max(SPEAKING_FLOOR) * if denoised { 32768.0 } else { 1.0 };
            let loud = if let Some(state) = self.denoiser.as_mut() {
                state.process_frame(&mut self.denoised, &frame);
                rms(&self.denoised) >= threshold
            } else {
                rms(&frame) >= threshold
            };

            let now = Instant::now();
            self.peak = self.peak.max(rms(&frame).min(1.0));
            if self.last_log.elapsed() >= Duration::from_secs(1) {
                log::info!(
                    "mic: rms_pico={:.4} limiar={:.2} ring={}",
                    self.peak,
                    self.sensitivity,
                    self.ring.len()
                );
                self.peak = 0.0;
                self.last_log = now;
            }
            if loud {
                self.open_until = Some(now + VAD_HANGOVER);
            }
            let speaking = loud || self.open_until.is_some_and(|until| now < until);
            if let Some(notify) = self.on_speaking.as_mut() {
                notify(speaking);
            }
            let open = self.sensitivity <= 0.0 || speaking;
            if open {
                let gain = if denoised { 1.0 / 32768.0 } else { 1.0 };
                if denoised {
                    let out: Vec<f32> = self.denoised.iter().map(|s| s * gain).collect();
                    self.ring.push(&out);
                } else {
                    let out: Vec<f32> = frame.iter().map(|s| s * gain).collect();
                    self.ring.push(&out);
                }
            } else {
                self.ring.clear();
            }
        }
    }
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// The live microphone as songbird sees it: a `MediaSource` of 48 kHz mono
/// f32 PCM that yields silence when the ring is empty, so the mixer is never
/// blocked and never sees an EOF.
pub struct MicSource {
    ring: Arc<Ring>,
    scratch: Vec<f32>,
}

impl MicSource {
    pub fn new(ring: Arc<Ring>) -> Self {
        Self {
            ring,
            scratch: Vec::new(),
        }
    }
}

impl Read for MicSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // One 20 ms packet per read, never padded beyond availability:
        // symphonia's stream grows its fetch block up to 64 kB, and serving
        // that in full would dilute the mic with padded silence (the
        // "cortando"). A zero-byte read would read as EOF, so a starved
        // call still yields one silent sample.
        let want = (buf.len() / 4).min(VOICE_RATE as usize / 50);
        if want == 0 {
            return Ok(0);
        }
        let have = self.ring.len().min(want).max(1);
        if self.scratch.len() < have {
            self.scratch.resize(have, 0.0);
        }
        let (block, _) = self.scratch.split_at_mut(have);
        self.ring.pop(block);
        for (i, sample) in block.iter().enumerate() {
            buf[i * 4..i * 4 + 4].copy_from_slice(&sample.to_le_bytes());
        }
        Ok(have * 4)
    }
}

impl Seek for MicSource {
    fn seek(&mut self, _: SeekFrom) -> std::io::Result<u64> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "o microfone não é procurável",
        ))
    }
}

impl MediaSource for MicSource {
    fn is_seekable(&self) -> bool {
        false
    }

    fn byte_len(&self) -> Option<u64> {
        None
    }
}
