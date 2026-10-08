use super::util::copy_seek_to;

use crate::{
    driver::tasks::message::MixerInputResultMessage,
    input::{AudioStream, AudioStreamError, Compose, Input, LiveInput, Parsed},
    Config,
};
use flume::Sender;
use rusty_pool::ThreadPool;
use std::{result::Result as StdResult, sync::Arc, time::Duration};
use symphonia_core::{
    formats::{SeekMode, SeekTo},
    io::MediaSource,
};
use tokio::runtime::Handle;

#[derive(Clone)]
pub struct BlockyTaskPool {
    pool: ThreadPool,
    handle: Handle,
}

impl BlockyTaskPool {
    pub fn new(handle: Handle) -> Self {
        Self {
            pool: ThreadPool::new(0, 64, Duration::from_secs(5)),
            handle,
        }
    }

    pub fn create(
        &self,
        callback: Sender<MixerInputResultMessage>,
        input: Input,
        seek_time: Option<SeekTo>,
        config: Arc<Config>,
    ) {
        // Moves an Input from Lazy -> Live.
        // We either do this on this pool, or move it to the tokio executor as the source requires.
        // This takes a seek_time to pass on and execute *after* parsing (i.e., back-seek on
        // read-only stream).
        match input {
            Input::Lazy(mut lazy) => {
                let far_pool = self.clone();
                if lazy.should_create_async() {
                    self.handle.spawn(async move {
                        let out = lazy.create_async().await;
                        far_pool.send_to_parse(out, lazy, callback, seek_time, config);
                    });
                } else {
                    self.pool.execute(move || {
                        let out = lazy.create();
                        far_pool.send_to_parse(out, lazy, callback, seek_time, config);
                    });
                }
            },
            Input::Live(live, maybe_create) =>
                self.parse(config, callback, live, maybe_create, seek_time),
        }
    }

    pub fn send_to_parse(
        &self,
        create_res: StdResult<AudioStream<Box<dyn MediaSource>>, AudioStreamError>,
        rec: Box<dyn Compose>,
        callback: Sender<MixerInputResultMessage>,
        seek_time: Option<SeekTo>,
        config: Arc<Config>,
    ) {
        match create_res {
            Ok(o) => {
                self.parse(config, callback, LiveInput::Raw(o), Some(rec), seek_time);
            },
            Err(e) => {
                drop(callback.send(MixerInputResultMessage::CreateErr(e.into())));
            },
        }
    }

    pub fn parse(
        &self,
        config: Arc<Config>,
        callback: Sender<MixerInputResultMessage>,
        input: LiveInput,
        rec: Option<Box<dyn Compose>>,
        seek_time: Option<SeekTo>,
    ) {
        let pool_clone = self.clone();

        self.pool.execute(move || {
            match input.promote(config.codec_registry, config.format_registry) {
                Ok(LiveInput::Parsed(parsed)) => match seek_time {
                    // If seek time is zero, then wipe it out.
                    // Some formats (MKV) make SeekTo(0) require a backseek to realign with the
                    // current page.
                    Some(seek_time) if !super::util::seek_to_is_zero(&seek_time) => {
                        pool_clone.seek(callback, parsed, rec, seek_time, false, config);
                    },
                    _ => {
                        drop(callback.send(MixerInputResultMessage::Built(parsed, rec)));
                    },
                },
                Ok(_) => unreachable!(),
                Err(e) => {
                    drop(callback.send(MixerInputResultMessage::ParseErr(e.into())));
                },
            }
        });
    }

    pub fn seek(
        &self,
        callback: Sender<MixerInputResultMessage>,
        mut input: Parsed,
        rec: Option<Box<dyn Compose>>,
        seek_time: SeekTo,
        // Not all of symphonia's formats bother to return SeekErrorKind::ForwardOnly.
        // So, we need *this* flag.
        backseek_needed: bool,
        config: Arc<Config>,
    ) {
        let pool_clone = self.clone();

        self.pool.execute(move || match rec {
            Some(rec) if (!input.supports_backseek) && backseek_needed => {
                pool_clone.create(callback, Input::Lazy(rec), Some(seek_time), config);
            },
            _ => {
                let seek_result = input
                    .format
                    .seek(SeekMode::Accurate, copy_seek_to(&seek_time));
                input.decoder.reset();
                drop(callback.send(MixerInputResultMessage::Seek(
                    input,
                    rec,
                    seek_result.map_err(Arc::new),
                )));
            },
        });
    }
}
