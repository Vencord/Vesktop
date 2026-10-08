//! Screen capture for both share backends (docs/SCREENSHARE.md): the
//! ScreenCast portal picks a monitor or window and hands over a PipeWire
//! node; a PipeWire stream on its own thread copies each frame (SHM, BGRx
//! or RGBx) into a latest-frame slot. The copy is a plain row memcpy so the
//! buffer goes back to the portal at once — converting in the callback
//! starved xdph ("Out of buffers") and made it renegotiate ~8x a second.
//! Consumers (the preview now, the encoder later) convert at their pace.

use std::os::fd::OwnedFd;
use std::sync::{Arc, Mutex};

use ashpd::desktop::{PersistMode, Session};
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::param::video::VideoFormat;

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

/// A running capture. Dropping it stops the PipeWire stream and closes the
/// portal session.
pub struct Capture {
    /// Latest frame, shared: the preview and the encoder both read it and
    /// tell new frames apart by `seq`.
    pub frame: Shared,
    /// `seq` of the frame the preview last uploaded.
    pub preview_seq: u64,
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
/// `runtime` must outlive every capture: ashpd caches its D-Bus connection
/// in a static, bound to the runtime that first opened it — a per-capture
/// runtime left every later picker hanging forever.
pub fn start(runtime: tokio::runtime::Handle, on_frame: impl Fn() + Send + 'static) -> Capture {
    let frame = Arc::new(Mutex::new(None));
    let ended = Arc::new(Mutex::new(None));
    let (stop, stop_rx) = pw::channel::channel();
    let thread_frame = Arc::clone(&frame);
    let thread_ended = Arc::clone(&ended);
    let spawned = std::thread::Builder::new()
        .name("fastdiscord-capture".into())
        .spawn(move || {
            let reason = match run(&runtime, &thread_frame, stop_rx, on_frame) {
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
    Capture {
        frame,
        preview_seq: 0,
        ended,
        stop,
    }
}

fn run(
    runtime: &tokio::runtime::Handle,
    slot: &Shared,
    stop_rx: pw::channel::Receiver<()>,
    on_frame: impl Fn() + 'static,
) -> Result<(), String> {
    let (node_id, fd, session) = runtime
        .block_on(open_portal())
        .map_err(|err| format!("portal: {err}"))?;
    log::info!("captura: portal entregou o nó {node_id}");
    let streamed =
        stream_frames(node_id, fd, slot, stop_rx, on_frame).map_err(|err| format!("pipewire: {err}"));
    // The cached connection outlives us, so the portal would keep this
    // session (and its screencopy) alive unless it's closed explicitly.
    if let Err(err) = runtime.block_on(session.close()) {
        log::warn!("captura: falha ao fechar a sessão do portal: {err}");
    }
    streamed
}

async fn open_portal() -> ashpd::Result<(u32, OwnedFd, Session<Screencast>)> {
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
    Ok((node_id, fd, session))
}

fn stream_frames(
    node_id: u32,
    fd: OwnedFd,
    slot: &Shared,
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
            let bgr = matches!(format.format(), VideoFormat::BGRx | VideoFormat::BGRA);
            let Some(src) = data.data() else {
                return;
            };
            let Some(pixels) = pack(&src[offset.min(src.len())..], width, height, stride) else {
                return;
            };
            seq += 1;
            *slot.lock().unwrap() = Some(Arc::new(Frame {
                width,
                height,
                pixels,
                bgr,
                seq,
            }));
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

/// Packed 32-bit rows (any stride) to tightly packed rows, one memcpy per
/// row. `None` if the buffer is shorter than the frame.
fn pack(src: &[u8], width: u32, height: u32, stride: usize) -> Option<Vec<u8>> {
    let row = width as usize * 4;
    let stride = if stride == 0 { row } else { stride };
    if stride < row || src.len() < stride * (height as usize - 1) + row {
        return None;
    }
    let mut out = Vec::with_capacity(row * height as usize);
    for line in src.chunks(stride).take(height as usize) {
        out.extend_from_slice(&line[..row]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{Frame, pack};

    #[test]
    fn padded_stride_packs_and_previews_as_rgba() {
        // 2x2 BGRx, 12-byte stride (4 bytes of row padding).
        let src = [
            1, 2, 3, 0, 4, 5, 6, 0, 9, 9, 9, 9, //
            7, 8, 9, 0, 10, 11, 12, 0, 9, 9, 9, 9,
        ];
        let pixels = pack(&src, 2, 2, 12).unwrap();
        assert_eq!(pixels, [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]);
        assert!(pack(&src[..19], 2, 2, 12).is_none());

        let frame = Frame { width: 2, height: 2, pixels, bgr: true, seq: 1 };
        let (size, rgba) = frame.preview_rgba(640);
        assert_eq!(size, [2, 2]);
        assert_eq!(rgba, [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255]);
        // Downscale keeps every 2nd pixel of every 2nd row.
        assert_eq!(frame.preview_rgba(1), ([1, 1], vec![3, 2, 1, 255]));
    }
}
