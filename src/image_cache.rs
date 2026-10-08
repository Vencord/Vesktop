//! URL → egui texture cache. Avatars and guild icons are fetched off the UI
//! thread on a tokio worker and decoded with the `image` crate; the UI only
//! ever polls a plain channel.

use std::collections::{HashMap, HashSet};

use egui::TextureHandle;
use tokio::runtime::Handle;

struct Decoded {
    url: String,
    image: egui::ColorImage,
}

pub struct ImageCache {
    textures: HashMap<String, TextureHandle>,
    pending: HashSet<String>,
    rx: std::sync::mpsc::Receiver<Decoded>,
    tx: std::sync::mpsc::Sender<Decoded>,
    http: reqwest::Client,
    max_side: u32,
}

impl ImageCache {
    pub fn new(max_side: u32) -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        let http = reqwest::Client::builder()
            .user_agent(crate::backend::api::USER_AGENT)
            .build()
            .expect("failed to build the image HTTP client");
        Self {
            textures: HashMap::new(),
            pending: HashSet::new(),
            rx,
            tx,
            http,
            max_side,
        }
    }

    /// Returns the texture for `url`, kicking off a background fetch on the
    /// first call. Call every frame; the returned `Option` turns into `Some`
    /// once the download and decode finish.
    pub fn get(
        &mut self,
        ctx: &egui::Context,
        handle: &Handle,
        url: &str,
    ) -> Option<TextureHandle> {
        while let Ok(decoded) = self.rx.try_recv() {
            self.pending.remove(&decoded.url);
            let texture =
                ctx.load_texture(&decoded.url, decoded.image, egui::TextureOptions::LINEAR);
            self.textures.insert(decoded.url, texture);
        }

        if !self.textures.contains_key(url) && !self.pending.contains(url) {
            self.pending.insert(url.to_string());
            let tx = self.tx.clone();
            let http = self.http.clone();
            let url = url.to_string();
            let max_side = self.max_side;
            handle.spawn(async move {
                if let Some(image) = fetch(&http, &url, max_side).await {
                    let _ = tx.send(Decoded { url, image });
                }
            });
            return None;
        }

        self.textures.get(url).cloned()
    }
}

async fn fetch(http: &reqwest::Client, url: &str, max_side: u32) -> Option<egui::ColorImage> {
    let bytes = http
        .get(url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .await
        .ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    let img = img.thumbnail(max_side, max_side).into_rgba8();
    let (width, height) = img.dimensions();
    Some(egui::ColorImage::from_rgba_unmultiplied(
        [width as usize, height as usize],
        &img.into_raw(),
    ))
}
