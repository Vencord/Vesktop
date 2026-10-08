//! FockyTV as the screen share backend (docs/SCREENSHARE.md): instead of
//! Discord's Go Live, our capture is published over WHIP to a FockyTV server
//! (MediaMTX behind its `live-api`), and "Assistir" plays a member's live
//! over WHEP in the watch view. The pipeline is fockytv-share's (FockyTV `client/src/pipeline/
//! linux.rs`), minus its preview and audio branches: appsrc → encoder ladder
//! → rtph264pay → whipsink. The stream key is the nickname.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;

use crate::backend::capture::{Frame, Shared};

/// A live WHIP publish. Dropping it ends the broadcast: going to NULL makes
/// whipsink send the WHIP `DELETE`, so the stream leaves the server's list.
pub struct Publisher {
    stop: Arc<AtomicBool>,
    /// Set when the pipeline dies (server refused, network…).
    pub ended: Arc<Mutex<Option<String>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Publisher {
    /// Stops and waits (up to 3 s) for the WHIP `DELETE` to go out — for
    /// when the process is about to end (quit, logout) and a plain drop
    /// would leave the stream listed on the server until ICE times out.
    pub fn stop_and_wait(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        if let Some(thread) = self.thread.take() {
            while !thread.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

impl Drop for Publisher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Starts publishing `frames` as `key` to `server` (e.g.
/// `https://tv.huestavo.com`), capped at `fps` (the settings offer 60, 30
/// and 15, like fockytv-share). The pipeline runs on its own thread.
pub fn publish(server: &str, key: &str, fps: u32, frames: Shared) -> Publisher {
    let stop = Arc::new(AtomicBool::new(false));
    let ended = Arc::new(Mutex::new(None));
    let (server, key) = (server.trim_end_matches('/').to_string(), key.to_string());
    let (thread_stop, thread_ended) = (Arc::clone(&stop), Arc::clone(&ended));
    let spawned = std::thread::Builder::new()
        .name("fastdiscord-whip".into())
        .spawn(move || {
            let reason = match run(&server, &key, fps.clamp(1, 60), &frames, &thread_stop) {
                Ok(()) => "transmissão encerrada".to_string(),
                Err(err) => {
                    log::warn!("fockytv: {err}");
                    err
                }
            };
            *thread_ended.lock().unwrap() = Some(reason);
        });
    if let Err(err) = &spawned {
        *ended.lock().unwrap() = Some(format!("thread do WHIP: {err}"));
    }
    Publisher {
        stop,
        ended,
        thread: spawned.ok(),
    }
}

fn run(server: &str, key: &str, fps: u32, frames: &Shared, stop: &AtomicBool) -> Result<(), String> {
    gst::init().map_err(|err| format!("gstreamer: {err}"))?;
    // rtph264pay's default 1400-byte MTU plus SRTP/UDP/IP overflows a VPN
    // tunnel (~1420): MediaMTX logged constant loss and "invalid FU-A
    // packet (non-starting)". 1200 is what Discord's own RTP uses.
    // The bitrate follows the source size, so wait for the first frame.
    let first = loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        if let Some(frame) = frames.lock().unwrap().clone() {
            break frame;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let encoder = select_encoder()?;
    let bitrate = bitrate_for(first.width, first.height);
    let launch = format!(
        r#"
        appsrc name=vid is-live=true do-timestamp=true format=time max-bytes=8388608 block=false
        ! queue leaky=downstream max-size-buffers=2 max-size-time=0
        ! videorate drop-only=true ! capsfilter caps=video/x-raw,framerate={fps}/1
        ! videoconvert
        ! queue leaky=downstream max-size-buffers=2 max-size-time=0
        ! {encoder}
        ! h264parse
        ! rtph264pay pt=96 config-interval=-1 mtu=1200
        ! queue leaky=downstream max-size-time=1000000000
        ! whipsink name=whip whip-endpoint="{server}/api/whip" auth-token="{key}" use-link-headers=true
        "#,
        encoder = encoder.props(bitrate, fps * 2),
    );
    let pipeline = gst::parse::launch(&launch)
        .map_err(|err| format!("pipeline: {err}"))?
        .dynamic_cast::<gst::Pipeline>()
        .map_err(|_| "pipeline não é um bin".to_string())?;
    enable_nack(&pipeline);
    let appsrc = pipeline
        .by_name("vid")
        .and_then(|element| element.dynamic_cast::<gst_app::AppSrc>().ok())
        .ok_or("appsrc não encontrado")?;
    pipeline
        .set_state(gst::State::Playing)
        .map_err(|err| format!("play: {err}"))?;
    log::info!(
        "fockytv: publicando \"{key}\" em {server} ({} {}x{} @ {fps} fps, {} kbps)",
        encoder.element(),
        first.width,
        first.height,
        bitrate / 1000
    );

    let bus = pipeline.bus().ok_or("pipeline sem bus")?;
    let mut caps_for = None;
    let mut seq = 0;
    let result = loop {
        if stop.load(Ordering::Relaxed) {
            break Ok(());
        }
        if let Some(message) = bus.pop_filtered(&[gst::MessageType::Error, gst::MessageType::Eos]) {
            break Err(match message.view() {
                gst::MessageView::Error(err) => format!("{} ({:?})", err.error(), err.debug()),
                _ => "o servidor encerrou a transmissão".to_string(),
            });
        }
        let frame = frames.lock().unwrap().clone();
        let Some(frame) = frame.filter(|frame| frame.seq != seq) else {
            // Static screens deliver no new frames; WebRTC copes.
            std::thread::sleep(Duration::from_millis(4));
            continue;
        };
        seq = frame.seq;
        let shape = (frame.width, frame.height, frame.bgr);
        if caps_for != Some(shape) {
            caps_for = Some(shape);
            appsrc.set_caps(Some(
                &gst::Caps::builder("video/x-raw")
                    .field("format", if frame.bgr { "BGRx" } else { "RGBx" })
                    .field("width", frame.width as i32)
                    .field("height", frame.height as i32)
                    .field("framerate", gst::Fraction::new(0, 1))
                    .build(),
            ));
        }
        // Zero-copy: the buffer keeps the shared frame alive.
        if appsrc.push_buffer(gst::Buffer::from_slice(FrameBytes(frame))).is_err() {
            break Err("o pipeline recusou o quadro".into());
        }
    };

    // whipsink DELETEs the WHIP session on the way to NULL (an EOS first
    // never reached the bus; it only cost 2 s).
    let _ = pipeline.set_state(gst::State::Null);
    result
}

/// Turns on NACK retransmission on every webrtcbin transceiver inside
/// `pipeline` (whipsink's and whepsrc's): over a lossy link (a VPN, a
/// scene change's packet burst) a lost packet is re-sent instead of
/// smearing the picture until the next keyframe. Covers transceivers made
/// while building the pipeline and those made at negotiation.
fn enable_nack(pipeline: &gst::Pipeline) {
    fn nack(transceiver: &gst::glib::Object) {
        if transceiver.has_property("do-nack") {
            transceiver.set_property("do-nack", true);
        }
    }
    for element in pipeline.iterate_recurse().into_iter().flatten() {
        if element.factory().is_none_or(|factory| factory.name() != "webrtcbin") {
            continue;
        }
        element.connect("on-new-transceiver", false, |args| {
            if let Ok(transceiver) = args[1].get::<gst::glib::Object>() {
                nack(&transceiver);
            }
            None
        });
        // Already made (whipsink requests its pads at parse time): each
        // webrtcbin pad carries its transceiver. ("get-transceivers" returns
        // a GArray that glib can't hand to Rust.)
        for pad in element.pads() {
            if pad.has_property("transceiver")
                && let Some(transceiver) = pad.property::<Option<gst::glib::Object>>("transceiver")
            {
                nack(&transceiver);
            }
        }
    }
}

struct FrameBytes(Arc<Frame>);

impl AsRef<[u8]> for FrameBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0.pixels
    }
}

/// fockytv-share's `bitrate_for`: by source pixel count.
fn bitrate_for(width: u32, height: u32) -> u64 {
    match u64::from(width) * u64::from(height) {
        pixels if pixels <= 2_300_000 => 12_000_000,
        pixels if pixels <= 3_800_000 => 20_000_000,
        _ => 32_000_000,
    }
}

/// fockytv-share's encoder ladder: hardware first (VAAPI on Linux; NVENC
/// and Media Foundation on Windows), then x264 and openh264. Elements the
/// platform lacks fail the probe and drop out.
#[derive(Clone, Copy)]
enum Encoder {
    VaH264Lp,
    VaH264,
    NvH264,
    MfH264,
    X264,
    OpenH264,
}

impl Encoder {
    fn element(self) -> &'static str {
        match self {
            Self::VaH264Lp => "vah264lpenc",
            Self::VaH264 => "vah264enc",
            Self::NvH264 => "nvh264enc",
            Self::MfH264 => "mfh264enc",
            Self::X264 => "x264enc",
            Self::OpenH264 => "openh264enc",
        }
    }

    /// Launch chunk; openh264enc takes bps, the others kbps.
    fn props(self, bps: u64, gop: u32) -> String {
        let kbps = (bps / 1000).max(1);
        match self {
            Self::VaH264Lp | Self::VaH264 => {
                format!("{} name=venc bitrate={kbps} key-int-max={gop}", self.element())
            }
            Self::NvH264 => format!(
                "nvh264enc name=venc preset=low-latency-hq tune=ultra-low-latency \
                 rc-mode=cbr bitrate={kbps} gop-size={gop}"
            ),
            Self::MfH264 => format!("mfh264enc name=venc bitrate={kbps} gop-size={gop}"),
            Self::X264 => format!(
                "x264enc name=venc tune=zerolatency speed-preset=superfast bitrate={kbps} key-int-max={gop}"
            ),
            Self::OpenH264 => format!(
                "openh264enc name=venc usage-type=screen rate-control=bitrate \
                 scene-change-detection=false complexity=medium bitrate={bps} gop-size={gop}"
            ),
        }
    }
}

/// First encoder that actually encodes a few frames (a broken VAAPI driver
/// is found here, not mid-broadcast). Cached for the session.
fn select_encoder() -> Result<Encoder, String> {
    static CHOSEN: Mutex<Option<Encoder>> = Mutex::new(None);
    if let Some(encoder) = *CHOSEN.lock().unwrap() {
        return Ok(encoder);
    }
    let ladder = [
        Encoder::VaH264Lp,
        Encoder::VaH264,
        Encoder::NvH264,
        Encoder::MfH264,
        Encoder::X264,
        Encoder::OpenH264,
    ];
    for encoder in ladder {
        if gst::ElementFactory::find(encoder.element()).is_none() {
            continue;
        }
        let probe = format!(
            "videotestsrc num-buffers=5 ! video/x-raw,width=320,height=240 ! videoconvert ! {} ! fakesink",
            encoder.props(1_000_000, 30)
        );
        let works = gst::parse::launch(&probe).ok().is_some_and(|pipeline| {
            let ok = pipeline.set_state(gst::State::Playing).is_ok()
                && pipeline.bus().is_some_and(|bus| {
                    bus.timed_pop_filtered(
                        gst::ClockTime::from_seconds(5),
                        &[gst::MessageType::Eos, gst::MessageType::Error],
                    )
                    .is_some_and(|message| matches!(message.view(), gst::MessageView::Eos(_)))
                });
            let _ = pipeline.set_state(gst::State::Null);
            ok
        });
        if works {
            *CHOSEN.lock().unwrap() = Some(encoder);
            return Ok(encoder);
        }
        log::info!("fockytv: encoder {} indisponível", encoder.element());
    }
    Err("nenhum encoder H.264 do GStreamer funcionou".into())
}

/// Watching a FockyTV live over WHEP. Dropping it leaves (the pipeline
/// going to NULL makes whepsrc DELETE its session).
pub struct Viewer {
    stop: Arc<AtomicBool>,
    /// Set when the live ends or can't be opened.
    pub ended: Arc<Mutex<Option<String>>>,
}

impl Drop for Viewer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Plays `key`'s live: decoded RGBA frames land in `frames` (the watch
/// view's slot). `viewer` is our nick, for the server's "who's watching"
/// list.
pub fn watch(
    server: &str,
    key: &str,
    viewer: &str,
    frames: Arc<Mutex<Option<Frame>>>,
    events: crate::backend::EventTx,
) -> Viewer {
    let stop = Arc::new(AtomicBool::new(false));
    let ended = Arc::new(Mutex::new(None));
    let endpoint = format!("{}/api/whep?viewer={viewer}", server.trim_end_matches('/'));
    let key = key.to_string();
    let (thread_stop, thread_ended) = (Arc::clone(&stop), Arc::clone(&ended));
    let spawned = std::thread::Builder::new()
        .name("fastdiscord-whep".into())
        .spawn(move || {
            let reason = match play(&endpoint, &key, frames, events.clone(), &thread_stop) {
                Ok(()) => "você saiu da live".to_string(),
                Err(err) => {
                    log::warn!("fockytv: assistir {key}: {err}");
                    err
                }
            };
            *thread_ended.lock().unwrap() = Some(reason);
            events.repaint();
        });
    if let Err(err) = spawned {
        *ended.lock().unwrap() = Some(format!("thread do WHEP: {err}"));
    }
    Viewer { stop, ended }
}

fn play(
    endpoint: &str,
    key: &str,
    frames: Arc<Mutex<Option<Frame>>>,
    events: crate::backend::EventTx,
    stop: &AtomicBool,
) -> Result<(), String> {
    gst::init().map_err(|err| format!("gstreamer: {err}"))?;
    let pipeline = gst::Pipeline::new();
    let source = gst::ElementFactory::make("whepsrc")
        .property("whep-endpoint", endpoint)
        .property("auth-token", key)
        // No use-link-headers here: reading the server's Link headers made
        // whepsrc offer twice, and the duplicate transceiver left its pad
        // unlinked ("not-linked", the view closing ~3 s in).
        // RTP caps with the browsers' H.264 fmtp: pion (in MediaMTX) only
        // matches H.264 on packetization-mode + profile-level-id.
        .property(
            "video-caps",
            gst::Caps::builder("application/x-rtp")
                .field("media", "video")
                .field("encoding-name", "H264")
                .field("payload", 103i32)
                .field("clock-rate", 90_000i32)
                .field("packetization-mode", "1")
                .field("profile-level-id", "42e01f")
                .field("level-asymmetry-allowed", "1")
                .build(),
        )
        // ponytail: no audio. whepsrc bundles every m-line after the first
        // as port 0, which MediaMTX reads as rejected — so offering audio
        // first got the video refused ("codecs not supported by client").
        // Audio needs whepclientsrc (not packaged here) or a video-first
        // offer.
        .property("audio-caps", gst::Caps::new_empty())
        .build()
        .map_err(|err| format!("whepsrc: {err}"))?;
    pipeline.add(&source).map_err(|err| err.to_string())?;
    enable_nack(&pipeline);

    // whepsrc exposes the video track as an RTP pad: depay, decode, RGBA.
    let weak = pipeline.downgrade();
    source.connect_pad_added(move |_, pad| {
        let Some(pipeline) = weak.upgrade() else { return };
        // Only video is offered, so every pad is the video track. The chain
        // must be static: with decodebin3's dynamic output, the bin's ghost
        // "sink" landed on videoconvert, the link failed ("Noformat") and
        // whepsrc died "not-linked" ~3 s in.
        let decoder = ["vah264dec", "d3d11h264dec", "openh264dec"]
            .into_iter()
            .find(|name| gst::ElementFactory::find(name).is_some())
            .unwrap_or("avdec_h264");
        let description = format!(
            // request-keyframe sends a PLI on loss; no wait-for-keyframe:
            // on a lossy link a whole IDR (hundreds of packets) almost never
            // arrives intact, and the view froze for good.
            "queue ! rtph264depay request-keyframe=true \
             ! video/x-h264,alignment=au ! h264parse ! {decoder} ! videoconvert \
             ! video/x-raw,format=RGBA ! appsink name=frames sync=false max-buffers=1 drop=true"
        );
        let Ok(branch) = gst::parse::bin_from_description(&description, true) else {
            return log::warn!("fockytv: ramo de vídeo não montou");
        };
        if let Some(sink) = branch
            .by_name("frames")
            .and_then(|sink| sink.dynamic_cast::<gst_app::AppSink>().ok())
        {
            let (frames, events) = (Arc::clone(&frames), events.clone());
            let mut seq = 0;
            sink.set_callbacks(
                gst_app::AppSinkCallbacks::builder()
                    .new_sample(move |sink| {
                        let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                        let size = sample.caps().and_then(|caps| {
                            let s = caps.structure(0)?;
                            Some((s.get::<i32>("width").ok()?, s.get::<i32>("height").ok()?))
                        });
                        let (Some((width, height)), Some(buffer)) = (size, sample.buffer()) else {
                            return Ok(gst::FlowSuccess::Ok);
                        };
                        let map = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
                        seq += 1;
                        *frames.lock().unwrap() = Some(Frame {
                            width: width as u32,
                            height: height as u32,
                            pixels: map.as_slice().to_vec(),
                            bgr: false,
                            seq,
                        });
                        events.repaint();
                        Ok(gst::FlowSuccess::Ok)
                    })
                    .build(),
            );
        }
        let _ = pipeline.add(&branch);
        let _ = branch.sync_state_with_parent();
        if let Some(sink_pad) = branch.static_pad("sink") {
            let _ = pad.link(&sink_pad);
        }
    });

    pipeline
        .set_state(gst::State::Playing)
        .map_err(|err| format!("play: {err}"))?;
    log::info!("fockytv: assistindo \"{key}\"");
    let bus = pipeline.bus().ok_or("pipeline sem bus")?;
    let result = loop {
        if stop.load(Ordering::Relaxed) {
            break Ok(());
        }
        let message = bus.timed_pop_filtered(
            gst::ClockTime::from_mseconds(100),
            &[gst::MessageType::Error, gst::MessageType::Eos],
        );
        if let Some(message) = message {
            break Err(match message.view() {
                gst::MessageView::Error(err) => format!("{} ({:?})", err.error(), err.debug()),
                _ => "a live terminou".to_string(),
            });
        }
    };
    let _ = pipeline.set_state(gst::State::Null);
    result
}

/// Who's live on the server right now (`/api/status` stream keys).
pub async fn live_keys(server: &str) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct Stream {
        #[serde(rename = "streamKey")]
        stream_key: String,
    }
    let url = format!("{}/api/status", server.trim_end_matches('/'));
    let streams: Vec<Stream> = reqwest::get(&url)
        .await
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;
    Ok(streams.into_iter().map(|stream| stream.stream_key).collect())
}

#[cfg(test)]
mod tests {
    use super::bitrate_for;

    #[test]
    fn bitrate_follows_source_size() {
        assert_eq!(bitrate_for(1920, 1080), 12_000_000);
        assert_eq!(bitrate_for(2560, 1080), 20_000_000);
        assert_eq!(bitrate_for(3840, 2160), 32_000_000);
    }
}
