//! Voice audio I/O (docs/VOICE.md, phases 2-4), through the desktop sound
//! server via the PulseAudio API — on this setup, PipeWire itself. This
//! keeps the device list identical to the desktop's, resampling and channel
//! conversion native, per-app volume working, and the hardware owned by the
//! sound server (opening ALSA PCMs directly would make devices "vanish").
//!
//! Playback: the mixed VoiceTick PCM lands in a ring; the write callback
//! starts after a short prebuffer and drains it. Capture: the read callback
//! feeds a denoise + voice-activity chain whose output songbird reads via a
//! silent-when-empty `MediaSource`.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use libpulse_binding::context::{Context, FlagSet as ContextFlagSet, State as ContextState};
use libpulse_binding::def::BufferAttr;
use libpulse_binding::mainloop::threaded::Mainloop;
use libpulse_binding::sample::{Format as SampleFormatPulse, Spec as SampleSpec};
use libpulse_binding::proplist::Proplist;
use libpulse_binding::stream::{
    FlagSet as StreamFlagSet,
    PeekResult,
    SeekMode,
    Stream,
};
use nnnoiseless::DenoiseState;
use symphonia_core::io::MediaSource;

/// Discord voice runs at 48 kHz.
pub const VOICE_RATE: u32 = 48_000;

const CHANNELS: u8 = 2;

/// Playback ring depth, stereo samples: ≈200 ms to absorb mixer/scheduler
/// jitter without a noticeable delay.
const OUTPUT_CAP: usize = 2 * VOICE_RATE as usize / 5;
/// Microphone ring depth, mono samples: headroom for the burst pattern
/// between the capture callback and songbird's 20 ms mixer pulls.
const INPUT_CAP: usize = VOICE_RATE as usize / 10;
/// Stereo samples (3 ticks ≈ 60 ms) to accumulate before starting playback;
/// without it, the mixer's 20 ms cadence sounds like constant crackle.
const PREBUFFER: usize = 3 * 2 * VOICE_RATE as usize / 50;
/// One 20 ms packet, in bytes — the quantum the sound server works in.
const PACKET_BYTES: usize = 2 * VOICE_RATE as usize / 50 * 4;
/// How long the voice-activity gate stays open after audio drops below the
/// sensitivity threshold, so word tails aren't clipped.
const VAD_HANGOVER: Duration = Duration::from_millis(300);
/// f32 block to little-endian bytes for the pulse stream.
fn block_as_bytes(block: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(block.len() * 4);
    for sample in block {
        bytes.extend_from_slice(&sample.clamp(-1.0, 1.0).to_le_bytes());
    }
    bytes
}

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

static INPUT_DEVICES: OnceLock<Vec<(String, String)>> = OnceLock::new();
static OUTPUT_DEVICES: OnceLock<Vec<(String, String)>> = OnceLock::new();

/// `(pulse name, friendly description)` of every device, matching what the
/// desktop's sound settings show. Cached: the settings window calls this per
/// frame.
pub fn list_devices(output: bool) -> Vec<(String, String)> {
    let cache = if output { &OUTPUT_DEVICES } else { &INPUT_DEVICES };
    cache.get_or_init(|| enumerate_devices(output)).clone()
}

/// `(name, description)` pairs from the sound server.
pub fn enumerate_devices(output: bool) -> Vec<(String, String)> {
    use libpulse_binding::callbacks::ListResult;
    use libpulse_binding::mainloop::standard::{IterateResult, Mainloop as StandardMainloop};

    let Some(mut mainloop) = StandardMainloop::new() else {
        return Vec::new();
    };
    let Some(mut context) = Context::new(&mainloop, "fastdiscord-list") else {
        return Vec::new();
    };
    if let Err(err) = context.connect(None, ContextFlagSet::NOFLAGS, None) {
        log::warn!("pulse: listagem falhou ao conectar: {err}");
        return Vec::new();
    }
    // Pump the loop until the context is ready (or the deadline passes).
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut ready = false;
    while Instant::now() < deadline {
        if let IterateResult::Quit(_) = mainloop.iterate(false) {
            return Vec::new();
        }
        std::thread::sleep(Duration::from_millis(5));
        if context.get_state() == ContextState::Ready {
            ready = true;
            break;
        }
        if matches!(
            context.get_state(),
            ContextState::Failed | ContextState::Terminated
        ) {
            break;
        }
    }
    if !ready {
        return Vec::new();
    }

    let (tx, rx) = std::sync::mpsc::channel();
    {
        let introspector = context.introspect();
        let done = tx.clone();
        if output {
            introspector.get_sink_info_list(move |result| {
                if let ListResult::Item(info) = result {
                    let description = info
                        .proplist
                        .get_str("device.description")
                        .unwrap_or_default();
                    if let Some(name) = info.name.as_ref() {
                        let _ = done.send((name.to_string(), description));
                    }
                }
            });
        } else {
            introspector.get_source_info_list(move |result| {
                if let ListResult::Item(info) = result {
                    // Monitors loop a sink back into capture; only real
                    // microphones matter for voice.
                    if info.monitor_of_sink.is_some() {
                        return;
                    }
                    let description = info
                        .proplist
                        .get_str("device.description")
                        .unwrap_or_default();
                    if let Some(name) = info.name.as_ref() {
                        let _ = done.send((name.to_string(), description));
                    }
                }
            });
        }
    }

    let mut devices = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(device) => devices.push(device),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if let IterateResult::Quit(_) = mainloop.iterate(false) {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = context.disconnect();
    devices.sort_by(|a, b| a.1.cmp(&b.1));
    devices
}

fn wait_for_ready(mainloop: &mut Mainloop, context: &mut Context, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        mainloop.lock();
        let state = context.get_state();
        mainloop.unlock();
        match state {
            ContextState::Ready => return true,
            ContextState::Failed | ContextState::Terminated => return false,
            _ => {}
        }
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Runtime-auditable state for the persistent audio thread: device changes
/// and cork requests land here and the thread applies them under the
/// mainloop lock — no stream teardown, ever.
#[derive(Default)]
struct Requests {
    retarget: Mutex<Option<(Option<String>, Option<String>)>>,
    corked: AtomicBool,
}

/// Opened voice audio: the rings other code writes/reads plus the pulse
/// thread. The streams live for the whole task; device changes and
/// call join/leave are applied live (set_device / cork).
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

    /// Cork both streams (call ended) or uncork (joined).
    pub fn set_corked(&self, corked: bool) {
        self.requests.corked.store(corked, Ordering::Relaxed);
    }
}

impl Drop for AudioLinks {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Opens the playback and capture streams through the sound server.
pub fn start(
    output_device: Option<&str>,
    input_device: Option<&str>,
    sensitivity: u8,
    noise_suppression: bool,
    capture: Arc<Mutex<Capture>>,
) -> AudioLinks {
    // Align the sound server's scheduling quantum with the mixer's 20 ms
    // tick: callbacks then request exactly one tick per deposit, and the
    // player never has to pad shortfalls (the source of constant crackle).
    // One-shot before any audio thread exists.
    unsafe { std::env::set_var("PIPEWIRE_QUANTUM", "960/48000") };
    let output_ring = Ring::new(OUTPUT_CAP);
    let input_ring = Ring::new(INPUT_CAP);
    let requests = Arc::new(Requests::default());
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        let requests = Arc::clone(&requests);
        let output_ring = Arc::clone(&output_ring);
        let input_ring = Arc::clone(&input_ring);
        let output = output_device.map(str::to_string);
        let input = input_device.map(str::to_string);
        std::thread::Builder::new()
            .name("fastdiscord-voice-audio".into())
            .spawn(move || {
                run_pulse(
                    stop,
                    requests,
                    output,
                    input,
                    sensitivity,
                    noise_suppression,
                    capture,
                    output_ring,
                    input_ring,
                );
            })
            .ok()
    };
    if thread.is_none() {
        log::warn!("não consegui criar a thread de áudio");
    }
    AudioLinks {
        output_ring,
        input_ring,
        requests,
        stop,
    }
}

fn run_pulse(
    stop: Arc<AtomicBool>,
    requests: Arc<Requests>,
    output_device: Option<String>,
    input_device: Option<String>,
    sensitivity: u8,
    noise_suppression: bool,
    capture: Arc<Mutex<Capture>>,
    output_ring: Arc<Ring>,
    input_ring: Arc<Ring>,
) {
    let mut current_output = output_device.clone();
    let mut current_input = input_device.clone();
    let Some(mut mainloop) = Mainloop::new() else {
        log::warn!("pulse: sem mainloop");
        return;
    };
    // Without start(), the mainloop's thread never runs and the context
    // never reaches Ready.
    if let Err(err) = mainloop.start() {
        log::warn!("pulse: mainloop não iniciou: {err}");
        return;
    }
    let Some(mut context) = Context::new(&mainloop, "FastDiscord voice") else {
        log::warn!("pulse: sem contexto");
        return;
    };
    if let Err(err) = context.connect(None, ContextFlagSet::NOFLAGS, None) {
        log::warn!("pulse: sem conexão ao servidor de som: {err}");
        return;
    }
    if !wait_for_ready(&mut mainloop, &mut context, Duration::from_secs(5)) {
        log::warn!("pulse: servidor de som não respondeu");
        return;
    }

    let out_spec = SampleSpec {
        format: SampleFormatPulse::F32le,
        channels: CHANNELS,
        rate: VOICE_RATE,
    };
    let in_spec = SampleSpec {
        format: SampleFormatPulse::F32le,
        channels: 1,
        rate: VOICE_RATE,
    };
    let attrs = BufferAttr {
        maxlength: u32::MAX,
        // tlength/prebuf slack absorbs the CPU-vs-card clock drift between
        // the songbird tick timer and the device clock.
        tlength: PACKET_BYTES as u32 * 6,
        prebuf: PACKET_BYTES as u32 * 6,
        minreq: PACKET_BYTES as u32,
        fragsize: PACKET_BYTES as u32,
    };

    mainloop.lock();

    // Schedule our stream in 20 ms ticks (960 frames): the server then
    // requests exactly what the mixer deposits each tick, and the player
    // never pads shortfalls (the crackle). The env var alone can't do this
    // while another app drives the graph at 1024 frames.
    let Some(mut out_props) = Proplist::new() else {
        mainloop.unlock();
        log::warn!("pulse: sem proplist");
        return;
    };
    let _ = out_props.set_str("node.latency", "960/48000");
    let Some(mut out_stream) =
        Stream::new_with_proplist(&mut context, "fastdiscord-voz", &out_spec, None, &mut out_props)
    else {
        mainloop.unlock();
        log::warn!("pulse: stream de saída não abriu");
        return;
    };
    if let Err(err) = out_stream.connect_playback(
        output_device.as_deref(),
        Some(&attrs),
        StreamFlagSet::ADJUST_LATENCY,
        None,
        None,
    ) {
        log::warn!("pulse: saída falhou: {err}");
        mainloop.unlock();
        return;
    }
    let out_stream = Rc::new(RefCell::new(out_stream));
    let prime = Arc::new(AtomicU32::new(8));
    {
        let out_ring = Arc::clone(&output_ring);
        let callback_stream = Rc::clone(&out_stream);
        let player = Rc::new(RefCell::new(Player {
            last_log: Instant::now(),
            peak: 0.0,
            last_sample: 0.0,
            underruns: 0,
            buffering: true,
        }));
        let prime = Arc::clone(&prime);
        out_stream.borrow_mut().set_write_callback(Some(Box::new(move |_| {
            let mut player = player.borrow_mut();
            player_fill(&mut player, &mut callback_stream.borrow_mut(), &out_ring, &prime);
        })));
    }

    let Some(mut in_stream) = Stream::new(&mut context, "fastdiscord-mic", &in_spec, None) else {
        mainloop.unlock();
        log::warn!("pulse: stream de entrada não abriu");
        return;
    };
    let capture = Arc::new(Mutex::new(Capture::new(
        sensitivity,
        noise_suppression,
        Arc::clone(&input_ring),
    )));
    if let Err(err) =
        in_stream.connect_record(input_device.as_deref(), Some(&attrs), StreamFlagSet::ADJUST_LATENCY)
    {
        log::warn!("pulse: entrada falhou: {err}");
        mainloop.unlock();
        return;
    }
    let in_stream = Rc::new(RefCell::new(in_stream));
    {
        let capture = Arc::clone(&capture);
        let callback_stream = Rc::clone(&in_stream);
        in_stream.borrow_mut().set_read_callback(Some(Box::new(move |_| {
            capture_microphone(&mut callback_stream.borrow_mut(), &capture);
        })));
    }

    mainloop.unlock();
    let mut last_corked = false;

    log::info!(
        "voz de áudio ativa: saída {:?}, entrada {:?}",
        output_device,
        input_device
    );

    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(100));
        if let Some((out, inp)) = requests.retarget.lock().unwrap().take() {
            mainloop.lock();
            if out != current_output {
                let _ = out_stream.borrow_mut().disconnect();
                let res = out_stream.borrow_mut().connect_playback(
                    out.as_deref(),
                    Some(&attrs),
                    StreamFlagSet::ADJUST_LATENCY,
                    None,
                    None,
                );
                match res {
                    Ok(()) => {
                        log::info!("saída retargetada: {:?}", out);
                        current_output = out.clone();
                    }
                    Err(err) => log::warn!("retarget da saída falhou: {err}"),
                }
            }
            if inp != current_input {
                let _ = in_stream.borrow_mut().disconnect();
                let res = in_stream.borrow_mut().connect_record(
                    inp.as_deref(),
                    Some(&attrs),
                    StreamFlagSet::ADJUST_LATENCY,
                );
                match res {
                    Ok(()) => {
                        log::info!("entrada retargetada: {:?}", inp);
                        current_input = inp.clone();
                    }
                    Err(err) => log::warn!("retarget da entrada falhou: {err}"),
                }
            }
            mainloop.unlock();
        }
        let corked = requests.corked.load(Ordering::Relaxed);
        if corked != last_corked {
            mainloop.lock();
            if corked {
                let _ = out_stream.borrow_mut().cork(None);
                let _ = in_stream.borrow_mut().cork(None);
            } else {
                let _ = out_stream.borrow_mut().uncork(None);
                let _ = in_stream.borrow_mut().uncork(None);
                // Fresh call: rebuild the playback cushion.
                prime.store(8, Ordering::Relaxed);
            }
            mainloop.unlock();
            last_corked = corked;
        }
    }

    mainloop.lock();
    // Drop the callbacks first: disconnect events still dispatch on the
    // mainloop thread, and a callback running against a tearing-down
    // context crashes inside libpulse.
    out_stream.borrow_mut().set_write_callback(None);
    in_stream.borrow_mut().set_read_callback(None);
    let _ = out_stream.borrow_mut().disconnect();
    let _ = in_stream.borrow_mut().disconnect();
    context.disconnect();
    mainloop.unlock();
    mainloop.stop();
}

/// Playback callback state: a 1 Hz diagnostic of the audio actually served
/// to the sound server.
struct Player {
    last_log: Instant,
    peak: f32,
    last_sample: f32,
    underruns: u64,
    /// Jitter-buffer state: after the ring runs dry, play silence until it
    /// holds PREBUFFER again instead of serving fragments padded with zeros.
    buffering: bool,
}

fn player_fill(player: &mut Player, stream: &mut Stream, ring: &Ring, prime: &AtomicU32) {
    let Some(writable) = stream.writable_size() else {
        return;
    };
    if writable == 0 {
        return;
    }
    // Always serve the full request (short writes stall the server). The
    // mixer ticks 960 frames per 20 ms while PipeWire reads 1024 per period,
    // so a ring kept near empty runs short almost every period, and padding
    // those shortfalls with zeros is the crackle. Instead, play from a
    // PREBUFFER cushion and only fall back to silence once it is fully dry.
    let want = (writable / 4).max(1);
    if prime.load(Ordering::Relaxed) > 0 {
        prime.fetch_sub(1, Ordering::Relaxed);
        let block = vec![0.0f32; want];
        let _ = stream.write_copy(&block_as_bytes(&block), 0, SeekMode::Relative);
        return;
    }
    if player.buffering && ring.len() >= PREBUFFER {
        player.buffering = false;
    }
    let mut block = vec![0.0f32; want];
    if !player.buffering {
        let have = ring.len().min(want);
        if have < want {
            player.underruns += 1;
            player.buffering = true;
        }
        ring.pop(&mut block[..have]);
        if have > 0 {
            player.last_sample = block[have - 1];
        }
    }

    let now = Instant::now();
    player.peak = player.peak.max(rms(&block));
    if now.duration_since(player.last_log) >= Duration::from_secs(1) {
        log::info!(
            "saída: pediu {}, tocou {}, rms_pico={:.4}, ring={}, underruns={}",
            want,
            block.len(),
            player.peak,
            ring.len(),
            player.underruns
        );
        player.underruns = 0;
        player.peak = 0.0;
        player.last_log = now;
    }
    let _ = stream.write_copy(&block_as_bytes(&block), 0, SeekMode::Relative);
}

/// Capture callback: hands every complete chunk to the processing chain.
fn capture_microphone(stream: &mut Stream, capture: &Mutex<Capture>) {
    let Ok(mut guard) = capture.lock() else {
        return;
    };
    loop {
        match stream.peek() {
            Ok(PeekResult::Data(chunk)) => {
                let samples: Vec<f32> = chunk
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                guard.feed(&samples);
                let _ = stream.discard();
                if chunk.len() < 4 {
                    break;
                }
            }
            Ok(PeekResult::Hole(_)) => {
                let _ = stream.discard();
            }
            Ok(PeekResult::Empty) | Err(_) => break,
        }
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
            let threshold = self.sensitivity * if denoised { 32768.0 } else { 1.0 };
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
            let open = self.sensitivity <= 0.0
                || loud
                || self.open_until.is_some_and(|until| now < until);
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
