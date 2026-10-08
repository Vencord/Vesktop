//! Screen capture on Windows (docs/SCREENSHARE.md): GStreamer's Desktop
//! Duplication source on the primary monitor, cursor included, into the
//! shared slot as BGRx. There is no system picker as on Linux.
// ponytail: primary monitor only; a monitor/window picker would set
// d3d11screencapturesrc's monitor-index / window-handle.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;

use super::{Frame, Shared};

/// Starts capturing on its own thread; returns what stops it.
pub(super) fn start(
    _runtime: tokio::runtime::Handle,
    frame: Shared,
    ended: Arc<Mutex<Option<String>>>,
    on_frame: impl Fn() + Send + 'static,
) -> Box<dyn FnOnce() + Send> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_ended = Arc::clone(&ended);
    let spawned = std::thread::Builder::new()
        .name("fastdiscord-capture".into())
        .spawn(move || {
            let reason = match run(&frame, &thread_stop, on_frame) {
                Ok(()) => "captura encerrada".to_string(),
                Err(err) => {
                    log::warn!("captura de tela: {err}");
                    err
                }
            };
            *thread_ended.lock().unwrap() = Some(reason);
        });
    if let Err(err) = spawned {
        *ended.lock().unwrap() = Some(format!("thread de captura: {err}"));
    }
    Box::new(move || stop.store(true, Ordering::Relaxed))
}

fn run(slot: &Shared, stop: &AtomicBool, on_frame: impl Fn() + Send + 'static) -> Result<(), String> {
    gst::init().map_err(|err| format!("gstreamer: {err}"))?;
    let pipeline = gst::parse::launch(
        "d3d11screencapturesrc show-cursor=true ! d3d11download ! videoconvert \
         ! video/x-raw,format=BGRx ! appsink name=frames sync=false max-buffers=1 drop=true",
    )
    .map_err(|err| format!("pipeline: {err}"))?
    .dynamic_cast::<gst::Pipeline>()
    .map_err(|_| "pipeline não é um bin".to_string())?;
    let sink = pipeline
        .by_name("frames")
        .and_then(|sink| sink.dynamic_cast::<gst_app::AppSink>().ok())
        .ok_or("appsink não encontrado")?;
    let slot = Arc::clone(slot);
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
                // BGRx rows are 4-byte aligned already: no stride padding.
                *slot.lock().unwrap() = Some(Arc::new(Frame {
                    width: width as u32,
                    height: height as u32,
                    pixels: map.as_slice().to_vec(),
                    bgr: true,
                    seq,
                }));
                on_frame();
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );
    pipeline
        .set_state(gst::State::Playing)
        .map_err(|err| format!("play: {err}"))?;
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
                _ => "a captura terminou".to_string(),
            });
        }
    };
    let _ = pipeline.set_state(gst::State::Null);
    result
}
