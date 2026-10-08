//! Voice audio I/O on Linux, through the desktop sound server via the
//! PulseAudio API — on this setup, PipeWire itself. This keeps the device
//! list identical to the desktop's, resampling and channel conversion
//! native, per-app volume working, and the hardware owned by the sound
//! server (opening ALSA PCMs directly would make devices "vanish").
//!
//! Playback: the mixed VoiceTick PCM lands in a ring; the write callback
//! starts after a short prebuffer and drains it. Capture: the read callback
//! feeds the denoise + voice-activity chain (`super::Capture`).

use std::cell::RefCell;
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

use super::{Capture, INPUT_CAP, OUTPUT_CAP, PREBUFFER, Ring, VOICE_RATE, rms};

const CHANNELS: u8 = 2;
/// One 20 ms packet, in bytes — the quantum the sound server works in.
const PACKET_BYTES: usize = 2 * VOICE_RATE as usize / 50 * 4;

/// f32 block to little-endian bytes for the pulse stream.
fn block_as_bytes(block: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(block.len() * 4);
    for sample in block {
        bytes.extend_from_slice(&sample.clamp(-1.0, 1.0).to_le_bytes());
    }
    bytes
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

    // `None` marks the end of the list, so the wait below returns as soon
    // as the server is done instead of running out the deadline.
    let (tx, rx) = std::sync::mpsc::channel::<Option<(String, String)>>();
    {
        let introspector = context.introspect();
        if output {
            introspector.get_sink_info_list(move |result| match result {
                ListResult::Item(info) => {
                    let description = info
                        .proplist
                        .get_str("device.description")
                        .unwrap_or_default();
                    if let Some(name) = info.name.as_ref() {
                        let _ = tx.send(Some((name.to_string(), description)));
                    }
                }
                ListResult::End | ListResult::Error => {
                    let _ = tx.send(None);
                }
            });
        } else {
            introspector.get_source_info_list(move |result| match result {
                ListResult::Item(info) => {
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
                        let _ = tx.send(Some((name.to_string(), description)));
                    }
                }
                ListResult::End | ListResult::Error => {
                    let _ = tx.send(None);
                }
            });
        }
    }

    let mut devices = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    'pump: while Instant::now() < deadline {
        if let IterateResult::Quit(_) = mainloop.iterate(false) {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
        while let Ok(item) = rx.try_recv() {
            match item {
                Some(device) => devices.push(device),
                None => break 'pump,
            }
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
    let Some(mut context) = Context::new(&mainloop, "FastDiscord voice") else {
        log::warn!("pulse: sem contexto");
        return;
    };
    if let Err(err) = context.connect(None, ContextFlagSet::NOFLAGS, None) {
        log::warn!("pulse: sem conexão ao servidor de som: {err}");
        return;
    }
    // Start only after connect: once the loop thread runs, every libpulse
    // call needs the mainloop lock, and an unlocked connect raced it
    // ("Assertion 'c->defer_event == e' failed", abort). Without start()
    // the context never reaches Ready.
    if let Err(err) = mainloop.start() {
        log::warn!("pulse: mainloop não iniciou: {err}");
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
    // The shared capture (voice.rs tweaks it live) now feeds this ring.
    {
        let mut capture = capture.lock().unwrap();
        capture.ring = Arc::clone(&input_ring);
        capture.set_sensitivity(sensitivity);
        capture.set_noise_suppression(noise_suppression);
    }
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

