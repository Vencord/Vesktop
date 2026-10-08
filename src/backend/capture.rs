//! Screen capture for Go Live (docs/SCREENSHARE.md, phase 1): the
//! ScreenCast portal picks a monitor or window and hands over a PipeWire
//! node; a PipeWire stream on its own thread copies each frame (SHM, BGRx
//! or RGBx) into a latest-frame slot as RGBA. Consumers (the preview now,
//! the encoder later) read the slot at their own pace.

use std::os::fd::OwnedFd;
use std::sync::{Arc, Mutex};

use ashpd::desktop::PersistMode;
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::param::video::VideoFormat;

/// One captured frame, tightly packed RGBA.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Bumps on every new frame so readers can skip ones they've seen.
    pub seq: u64,
}

/// A running capture. Dropping it stops the PipeWire stream and closes the
/// portal session.
pub struct Capture {
    pub frame: Arc<Mutex<Option<Frame>>>,
    /// Set by the capture thread when the stream ends or fails.
    pub ended: Arc<Mutex<Option<String>>>,
    stop: pw::channel::Sender<()>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

/// Opens the portal picker and starts streaming. `on_frame` runs on the
/// capture thread after each new frame (the UI passes a repaint request).
pub fn start(on_frame: impl Fn() + Send + 'static) -> Capture {
    let frame = Arc::new(Mutex::new(None));
    let ended = Arc::new(Mutex::new(None));
    let (stop, stop_rx) = pw::channel::channel();
    let thread_frame = Arc::clone(&frame);
    let thread_ended = Arc::clone(&ended);
    let spawned = std::thread::Builder::new()
        .name("fastdiscord-capture".into())
        .spawn(move || {
            let reason = match run(&thread_frame, stop_rx, on_frame) {
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
    Capture { frame, ended, stop }
}

fn run(
    slot: &Arc<Mutex<Option<Frame>>>,
    stop_rx: pw::channel::Receiver<()>,
    on_frame: impl Fn() + 'static,
) -> Result<(), String> {
    // The portal is D-Bus (zbus on tokio); a small runtime on this thread
    // keeps it away from the backend's. It must outlive the stream: the
    // session closes when the proxy goes away.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| err.to_string())?;
    let (node_id, fd) = runtime
        .block_on(open_portal())
        .map_err(|err| format!("portal: {err}"))?;
    log::info!("captura: portal entregou o nó {node_id}");
    stream_frames(node_id, fd, slot, stop_rx, on_frame).map_err(|err| format!("pipewire: {err}"))
}

async fn open_portal() -> ashpd::Result<(u32, OwnedFd)> {
    let proxy = Screencast::new().await?;
    let session = proxy.create_session(Default::default()).await?;
    proxy
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_cursor_mode(CursorMode::Embedded)
                .set_sources(SourceType::Monitor | SourceType::Window)
                .set_multiple(false)
                .set_persist_mode(PersistMode::DoNot),
        )
        .await?;
    let response = proxy
        .start(&session, None, Default::default())
        .await?
        .response()?;
    let node_id = response
        .streams()
        .first()
        .map(|stream| stream.pipe_wire_node_id())
        .ok_or(ashpd::Error::NoResponse)?;
    let fd = proxy
        .open_pipe_wire_remote(&session, Default::default())
        .await?;
    Ok((node_id, fd))
}

fn stream_frames(
    node_id: u32,
    fd: OwnedFd,
    slot: &Arc<Mutex<Option<Frame>>>,
    stop_rx: pw::channel::Receiver<()>,
    on_frame: impl Fn() + 'static,
) -> Result<(), pw::Error> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_fd_rc(fd, None)?;

    let quit = mainloop.clone();
    let _stop = stop_rx.attach(mainloop.loop_(), move |()| quit.quit());

    let stream = pw::stream::StreamBox::new(
        &core,
        "fastdiscord-tela",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )?;

    let quit = mainloop.clone();
    let slot = Arc::clone(slot);
    let mut seq = 0u64;
    let _listener = stream
        .add_local_listener_with_user_data(spa::param::video::VideoInfoRaw::default())
        .state_changed(move |_, _, old, new| {
            log::info!("captura: {old:?} -> {new:?}");
            // The source went away (window closed, portal revoked).
            if matches!(
                new,
                pw::stream::StreamState::Error(_) | pw::stream::StreamState::Unconnected
            ) {
                quit.quit();
            }
        })
        .param_changed(|_, format, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            if format.parse(param).is_ok() {
                log::info!(
                    "captura: {:?} {}x{} @ {}/{}",
                    format.format(),
                    format.size().width,
                    format.size().height,
                    format.framerate().num,
                    format.framerate().denom
                );
            }
        })
        .process(move |stream, format| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                return;
            };
            let (width, height) = (format.size().width, format.size().height);
            let chunk = data.chunk();
            let (offset, stride) = (chunk.offset() as usize, chunk.stride() as usize);
            // Damage-only buffers (no new pixels) arrive with size 0.
            if chunk.size() == 0 || width == 0 || height == 0 {
                return;
            }
            let swap = matches!(format.format(), VideoFormat::BGRx | VideoFormat::BGRA);
            let Some(pixels) = data.data() else {
                return;
            };
            let Some(rgba) = to_rgba(&pixels[offset.min(pixels.len())..], width, height, stride, swap)
            else {
                return;
            };
            seq += 1;
            *slot.lock().unwrap() = Some(Frame {
                width,
                height,
                rgba,
                seq,
            });
            on_frame();
        })
        .register()?;

    // Offer only the 32-bit packed formats the portal hands out over SHM;
    // without DMA-BUF modifiers xdph never picks GPU buffers.
    let format = spa::pod::object!(
        spa::utils::SpaTypes::ObjectParamFormat,
        spa::param::ParamType::EnumFormat,
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaType,
            Id,
            spa::param::format::MediaType::Video
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaSubtype,
            Id,
            spa::param::format::MediaSubtype::Raw
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::BGRx,
            VideoFormat::BGRA,
            VideoFormat::RGBx,
            VideoFormat::RGBA,
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            spa::utils::Rectangle {
                width: 1920,
                height: 1080
            },
            spa::utils::Rectangle {
                width: 1,
                height: 1
            },
            spa::utils::Rectangle {
                width: 8192,
                height: 8192
            }
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            spa::utils::Fraction { num: 30, denom: 1 },
            spa::utils::Fraction { num: 0, denom: 1 },
            spa::utils::Fraction { num: 240, denom: 1 }
        ),
    );
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(format),
    )
    .map_err(|_| pw::Error::CreationFailed)?
    .0
    .into_inner();
    let mut params = [spa::pod::Pod::from_bytes(&bytes).ok_or(pw::Error::CreationFailed)?];
    stream.connect(
        spa::utils::Direction::Input,
        Some(node_id),
        pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
        &mut params,
    )?;

    mainloop.run();
    let _ = stream.disconnect();
    Ok(())
}

/// Packed 32-bit rows (any stride) to tight RGBA with opaque alpha; `swap`
/// for BGR order. `None` if the buffer is shorter than the frame.
fn to_rgba(src: &[u8], width: u32, height: u32, stride: usize, swap: bool) -> Option<Vec<u8>> {
    let row = width as usize * 4;
    let stride = if stride == 0 { row } else { stride };
    if stride < row || src.len() < stride * (height as usize - 1) + row {
        return None;
    }
    let mut out = Vec::with_capacity(row * height as usize);
    for line in src.chunks(stride).take(height as usize) {
        for px in line[..row].chunks_exact(4) {
            if swap {
                out.extend_from_slice(&[px[2], px[1], px[0], 255]);
            } else {
                out.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::to_rgba;

    #[test]
    fn bgrx_with_padded_stride_becomes_tight_rgba() {
        // 2x2 BGRx, 12-byte stride (4 bytes of row padding).
        let src = [
            1, 2, 3, 0, 4, 5, 6, 0, 9, 9, 9, 9, //
            7, 8, 9, 0, 10, 11, 12, 0, 9, 9, 9, 9,
        ];
        let rgba = to_rgba(&src, 2, 2, 12, true).unwrap();
        assert_eq!(rgba, [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255]);
        assert!(to_rgba(&src[..19], 2, 2, 12, true).is_none());
    }
}
