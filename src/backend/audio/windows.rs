//! Voice audio I/O on Windows, through WASAPI (cpal). Same shape as the
//! Linux backend: one thread owns both streams (cpal's `Stream` isn't
//! `Send`) and applies device changes and cork requests live. Streams ask
//! for 48 kHz in the device's channel count; WASAPI converts to the mix
//! format, so the voice path never resamples.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::{Capture, INPUT_CAP, OUTPUT_CAP, PREBUFFER, Ring, VOICE_RATE};

static INPUT_DEVICES: OnceLock<Vec<(String, String)>> = OnceLock::new();
static OUTPUT_DEVICES: OnceLock<Vec<(String, String)>> = OnceLock::new();

/// `(device id, friendly name)` of every device. Cached: the settings
/// window calls this per frame.
pub fn list_devices(output: bool) -> Vec<(String, String)> {
    let cache = if output { &OUTPUT_DEVICES } else { &INPUT_DEVICES };
    cache.get_or_init(|| enumerate(output)).clone()
}

fn enumerate(output: bool) -> Vec<(String, String)> {
    let host = cpal::default_host();
    let devices = if output {
        host.output_devices().map(|devices| devices.collect::<Vec<_>>())
    } else {
        host.input_devices().map(|devices| devices.collect::<Vec<_>>())
    };
    let mut list: Vec<(String, String)> = devices
        .unwrap_or_default()
        .into_iter()
        .filter_map(|device| {
            let id = device.id().ok()?.to_string();
            let name = device.description().ok()?.name().to_string();
            Some((id, name))
        })
        .collect();
    list.sort_by(|a, b| a.1.cmp(&b.1));
    list
}

/// Device changes and cork requests, applied by the audio thread.
#[derive(Default)]
struct Requests {
    retarget: Mutex<Option<(Option<String>, Option<String>)>>,
    corked: AtomicBool,
}

/// Opened voice audio: the rings other code writes/reads plus the thread
/// that owns the WASAPI streams.
pub struct AudioLinks {
    pub output_ring: Arc<Ring>,
    pub input_ring: Arc<Ring>,
    requests: Arc<Requests>,
    stop: Arc<AtomicBool>,
}

impl AudioLinks {
    /// Retarget one or both streams live; `None` = system default.
    pub fn set_devices(&self, output: Option<String>, input: Option<String>) {
        *self.requests.retarget.lock().unwrap() = Some((output, input));
    }

    /// Pause both streams (call ended) or resume (joined).
    pub fn set_corked(&self, corked: bool) {
        self.requests.corked.store(corked, Ordering::Relaxed);
    }
}

impl Drop for AudioLinks {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Opens the playback and capture streams.
pub fn start(
    output_device: Option<&str>,
    input_device: Option<&str>,
    sensitivity: u8,
    noise_suppression: bool,
    capture: Arc<Mutex<Capture>>,
) -> AudioLinks {
    let output_ring = Ring::new(OUTPUT_CAP);
    let input_ring = Ring::new(INPUT_CAP);
    {
        let mut capture = capture.lock().unwrap();
        capture.ring = Arc::clone(&input_ring);
        capture.set_sensitivity(sensitivity);
        capture.set_noise_suppression(noise_suppression);
    }
    let requests = Arc::new(Requests::default());
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let (stop, requests) = (Arc::clone(&stop), Arc::clone(&requests));
        let (output_ring, devices) = (
            Arc::clone(&output_ring),
            (output_device.map(str::to_string), input_device.map(str::to_string)),
        );
        std::thread::Builder::new()
            .name("fastdiscord-voice-audio".into())
            .spawn(move || run(&stop, &requests, devices, &output_ring, &capture))
    };
    if let Err(err) = thread {
        log::warn!("não consegui criar a thread de áudio: {err}");
    }
    AudioLinks {
        output_ring,
        input_ring,
        requests,
        stop,
    }
}

fn run(
    stop: &AtomicBool,
    requests: &Requests,
    mut devices: (Option<String>, Option<String>),
    output_ring: &Arc<Ring>,
    capture: &Arc<Mutex<Capture>>,
) {
    let host = cpal::default_host();
    let mut streams = open(&host, &devices, output_ring, capture);
    let mut corked = false;
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(wanted) = requests.retarget.lock().unwrap().take()
            && wanted != devices
        {
            devices = wanted;
            drop(streams);
            streams = open(&host, &devices, output_ring, capture);
            log::info!("áudio retargetado: {devices:?}");
            // Fresh streams play; the check below pauses them if corked.
            corked = false;
        }
        let want_corked = requests.corked.load(Ordering::Relaxed);
        if want_corked != corked {
            corked = want_corked;
            for stream in streams.iter().flatten() {
                let _ = if corked { stream.pause() } else { stream.play() };
            }
        }
    }
}

/// `[output, input]`, each `None` when it couldn't open.
fn open(
    host: &cpal::Host,
    (output, input): &(Option<String>, Option<String>),
    output_ring: &Arc<Ring>,
    capture: &Arc<Mutex<Capture>>,
) -> [Option<cpal::Stream>; 2] {
    let find = |id: &Option<String>, output: bool| {
        id.as_deref()
            .and_then(|id| id.parse().ok())
            .and_then(|id| host.device_by_id(&id))
            .or_else(|| {
                if output {
                    host.default_output_device()
                } else {
                    host.default_input_device()
                }
            })
    };
    let playback = find(output, true).and_then(|device| {
        open_playback(&device, Arc::clone(output_ring))
            .inspect_err(|err| log::warn!("saída de áudio falhou: {err}"))
            .ok()
    });
    let recording = find(input, false).and_then(|device| {
        open_recording(&device, Arc::clone(capture))
            .inspect_err(|err| log::warn!("entrada de áudio falhou: {err}"))
            .ok()
    });
    for stream in [&playback, &recording].into_iter().flatten() {
        let _ = stream.play();
    }
    [playback, recording]
}

fn config(device: &cpal::Device, output: bool) -> Result<cpal::StreamConfig, cpal::Error> {
    let default = if output {
        device.default_output_config()?
    } else {
        device.default_input_config()?
    };
    Ok(cpal::StreamConfig {
        channels: default.channels(),
        sample_rate: VOICE_RATE,
        buffer_size: cpal::BufferSize::Default,
    })
}

/// Pulls the stereo mix from the ring into the device's channel layout,
/// with the Linux backend's cushion: after running dry, play silence until
/// PREBUFFER is queued again instead of zero-padding every short period.
fn open_playback(device: &cpal::Device, ring: Arc<Ring>) -> Result<cpal::Stream, cpal::Error> {
    let config = config(device, true)?;
    let channels = usize::from(config.channels).max(1);
    let mut buffering = true;
    let mut stereo = Vec::new();
    device.build_output_stream::<f32, _, _>(
        config,
        move |out, _| {
            let frames = out.len() / channels;
            stereo.resize(frames * 2, 0.0);
            stereo.fill(0.0);
            if buffering && ring.len() >= PREBUFFER {
                buffering = false;
            }
            if !buffering {
                let have = ring.len().min(stereo.len());
                if have < stereo.len() {
                    buffering = true;
                }
                ring.pop(&mut stereo[..have]);
            }
            for (frame, lr) in out.chunks_mut(channels).zip(stereo.chunks(2)) {
                match frame {
                    [mono] => *mono = (lr[0] + lr[1]) / 2.0,
                    [left, right, rest @ ..] => {
                        (*left, *right) = (lr[0], lr[1]);
                        rest.fill(0.0);
                    }
                    [] => {}
                }
            }
        },
        |err| log::warn!("saída de áudio: {err}"),
        None,
    )
}

/// Downmixes the microphone to mono and feeds the shared chain.
fn open_recording(
    device: &cpal::Device,
    capture: Arc<Mutex<Capture>>,
) -> Result<cpal::Stream, cpal::Error> {
    let config = config(device, false)?;
    let channels = usize::from(config.channels).max(1);
    let mut mono = Vec::new();
    device.build_input_stream::<f32, _, _>(
        config,
        move |data, _| {
            mono.clear();
            mono.extend(
                data.chunks(channels)
                    .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32),
            );
            if let Ok(mut capture) = capture.lock() {
                capture.feed(&mono);
            }
        },
        |err| log::warn!("entrada de áudio: {err}"),
        None,
    )
}
