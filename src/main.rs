//! Vesktop — a native Discord client built with Rust and egui.

use clap::Parser;

/// A native Discord client built with Rust and egui.
#[derive(Parser, Debug)]
#[command(name = "vesktop", version, about)]
struct Args {
    /// Discord account token, overriding the one saved in the settings file.
    #[arg(long, value_name = "TOKEN")]
    token: Option<String>,
}

fn main() -> anyhow::Result<()> {
    // The portable Windows build ships its GStreamer plugins next to the
    // exe (the DLLs they need sit beside it too, where the loader looks).
    #[cfg(windows)]
    if let Some(plugins) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("lib").join("gstreamer-1.0")))
        .filter(|dir| dir.is_dir())
    {
        // SAFETY: still single-threaded here, before any GStreamer use.
        unsafe { std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", plugins) };
    }

    // tracing-subscriber instead of env_logger: it captures both our `log`
    // records and songbird's `tracing` internals (voice WS, DAVE, mixer).
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .without_time()
        .init();
    let args = Args::parse();

    let mut settings = fastdiscord::settings::Settings::load().unwrap_or_default();
    if let Some(token) = args.token {
        settings.token = Some(token);
        settings.save();
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let handle = runtime.handle().clone();

    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut viewport = egui::ViewportBuilder::default()
        .with_inner_size([1280.0, 800.0])
        .with_min_inner_size([940.0, 600.0])
        .with_title("FastDiscord");
    if let Some(icon) = fastdiscord::window::load_icon() {
        viewport = viewport.with_icon(icon);
    }

    let options = eframe::NativeOptions {
        viewport,
        // With vsync, eglSwapBuffers waits for the compositor's frame
        // callback, which Hyprland withholds from windows that aren't
        // visible (other workspace): any repaint while hidden (voice events,
        // the FockyTV poll) blocked the main thread, pings went unanswered
        // and Hyprland showed "Application Not Responding". egui repaints
        // only on demand, so no vsync costs nothing.
        glow_options: eframe::egui_glow::GlowConfiguration {
            vsync: false,
            ..Default::default()
        },
        ..Default::default()
    };

    eframe::run_native(
        "FastDiscord",
        options,
        Box::new(move |cc| {
            let app = fastdiscord::app::VesktopApp::new(cc, settings, handle, event_tx, event_rx);
            Ok(Box::new(app))
        }),
    )
    .map_err(|err| anyhow::anyhow!("eframe exited with an error: {err}"))?;

    // Background tasks die with the runtime once the UI loop returns.
    drop(runtime);
    Ok(())
}
