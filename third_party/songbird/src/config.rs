#[cfg(all(feature = "driver", feature = "receive"))]
use crate::driver::DecodeMode;
use crate::FloatDuration;
#[cfg(feature = "driver")]
use crate::{
    driver::{
        get_default_scheduler,
        retry::Retry,
        tasks::disposal::DisposalThread,
        CryptoMode,
        MixMode,
        Scheduler,
    },
    input::codecs::*,
};

#[cfg(test)]
use crate::driver::test_config::*;
#[cfg(all(test, feature = "driver"))]
use crate::driver::SchedulerConfig;

#[cfg(feature = "driver")]
use symphonia::core::{codecs::CodecRegistry, probe::Probe};

use derivative::Derivative;
#[cfg(all(feature = "driver", feature = "receive"))]
use std::num::NonZeroU8;
use std::time::Duration;

/// Configuration for drivers and calls.
#[derive(Clone, Derivative)]
#[derivative(Debug)]
#[non_exhaustive]
pub struct Config {
    #[cfg(feature = "driver")]
    /// Selected tagging mode for voice packet encryption.
    ///
    /// Defaults to [`CryptoMode::Aes256Gcm`].
    ///
    /// Changes to this field will not immediately apply if the
    /// driver is actively connected, but will apply to subsequent
    /// sessions.
    ///
    /// [`CryptoMode::Aes256Gcm`]: CryptoMode::Aes256Gcm
    pub crypto_mode: CryptoMode,

    #[cfg(all(feature = "driver", feature = "receive"))]
    /// Configures whether decoding and decryption occur for all received packets.
    ///
    /// If receiving and using voice packets, generally you should choose [`DecodeMode::Decode`].
    /// [`DecodeMode::Decrypt`] is intended for users running their own selective decoding or
    /// who need to inspect Opus packets. [User speaking state] can still be seen using [`DecodeMode::Pass`].
    /// If you're certain you will never need any RT(C)P events, then consider building without
    /// the `"receive"` feature for extra performance.
    ///
    /// Defaults to [`DecodeMode::Decrypt`]. This is due to per-packet decoding costs,
    /// which most users will not want to pay, but allowing speaking events which are commonly used.
    ///
    /// [`DecodeMode::Decode`]: DecodeMode::Decode
    /// [`DecodeMode::Decrypt`]: DecodeMode::Decrypt
    /// [`DecodeMode::Pass`]: DecodeMode::Pass
    /// [User speaking state]: crate::events::CoreEvent::VoiceTick
    pub decode_mode: DecodeMode,

    #[cfg(all(feature = "driver", feature = "receive"))]
    /// Configures the amount of time after a user/SSRC is inactive before their decoder state
    /// should be removed.
    ///
    /// Defaults to 1 minute.
    pub decode_state_timeout: FloatDuration,

    #[cfg(all(feature = "driver", feature = "receive"))]
    /// Configures the number of audio packets to buffer for each user before playout.
    ///
    /// A playout buffer allows Songbird to smooth out jitter in audio packet arrivals,
    /// as well as to correct for reordering of packets by the network.
    ///
    /// This does not affect the arrival of raw packet events.
    ///
    /// Defaults to 5 packets (100ms).
    pub playout_buffer_length: NonZeroU8,

    #[cfg(all(feature = "driver", feature = "receive"))]
    /// Configures the initial amount of extra space allocated to handle packet bursts.
    ///
    /// Each SSRC's receive buffer will start at capacity `playout_buffer_length +
    /// playout_spike_length`, up to a maximum 64 packets.
    ///
    /// Defaults to 3 packets (thus capacity defaults to 8).
    pub playout_spike_length: u8,

    #[cfg(feature = "gateway")]
    /// Configures the amount of time to wait for Discord to reply with connection information
    /// if [`Call::join`]/[`join_gateway`] are used.
    ///
    /// This is a useful fallback in the event that:
    ///  * the underlying Discord client restarts and loses a join request, or
    ///  * a channel join fails because the bot is already believed to be there.
    ///
    /// Defaults to 10 seconds. If set to `None`, connections will never time out.
    ///
    /// [`Call::join`]: crate::Call::join
    /// [`join_gateway`]: crate::Call::join_gateway
    pub gateway_timeout: Option<FloatDuration>,

    #[cfg(feature = "driver")]
    /// Configures whether the driver will mix and output stereo or mono Opus data
    /// over a voice channel.
    ///
    /// Defaults to [`Stereo`].
    ///
    /// [`Stereo`]: MixMode::Stereo
    pub mix_mode: MixMode,

    #[cfg(feature = "driver")]
    /// Number of concurrently active tracks to allocate memory for.
    ///
    /// This should be set at, or just above, the maximum number of tracks
    /// you expect your bot will play at the same time. Exceeding the size of
    /// the internal queue will trigger a larger memory allocation and copy,
    /// possibly causing the mixer thread to miss a packet deadline.
    ///
    /// Defaults to `1`.
    ///
    /// Changes to this field in a running driver will only ever increase
    /// the capacity of the track store.
    pub preallocated_tracks: u8,

    #[cfg(feature = "driver")]
    /// Connection retry logic for the [`Driver`].
    ///
    /// This controls how many times the [`Driver`] should retry any connections,
    /// as well as how long to wait between attempts.
    ///
    /// [`Driver`]: crate::driver::Driver
    pub driver_retry: Retry,

    #[cfg(feature = "driver")]
    /// Configures whether or not each mixed audio packet is [soft-clipped] into the
    /// [-1, 1] audio range.
    ///
    /// Defaults to `true`, preventing clipping and dangerously loud audio from being sent.
    ///
    /// **This operation adds ~3% cost to a standard (non-passthrough) mix cycle.**
    /// If you *know* that your bot will only play one sound at a time and that
    /// your volume is between `0.0` and `1.0`, then you can disable soft-clipping
    /// for a performance boost. If you are playing several sounds at once, do not
    /// disable this unless you make sure to reduce the volume of each sound.
    ///
    /// [soft-clipped]: https://opus-codec.org/docs/opus_api-1.3.1/group__opus__decoder.html#gaff99598b352e8939dded08d96e125e0b
    pub use_softclip: bool,

    #[cfg(feature = "driver")]
    /// Configures the maximum amount of time to wait for an attempted voice
    /// connection to Discord.
    ///
    /// Defaults to 10 seconds. If set to `None`, connections will never time out.
    pub driver_timeout: Option<FloatDuration>,

    #[cfg(feature = "driver")]
    #[derivative(Debug = "ignore")]
    /// Registry of the inner codecs supported by the driver, adding opus2-based
    /// Opus codec support to all of Symphonia's default codecs.
    ///
    /// Defaults to [`get_codec_registry`].
    pub codec_registry: &'static CodecRegistry,

    #[cfg(feature = "driver")]
    #[derivative(Debug = "ignore")]
    /// Registry of the muxers and container formats supported by the driver.
    ///
    /// Defaults to [`get_probe`], which includes all of Symphonia's default format handlers
    /// and DCA format support.
    pub format_registry: &'static Probe,

    #[cfg(feature = "driver")]
    /// The Sender for a channel that will run the destructor of possibly blocking values.
    ///
    /// If not set, a thread will be spawned to perform this, but it is recommended to create
    /// a long running thread instead of relying on a per-driver thread.
    ///
    /// Note: When using [`Songbird`] this is overwritten automatically by its disposal thread.
    ///
    /// [`Songbird`]: crate::Songbird
    pub disposer: Option<DisposalThread>,

    #[cfg(feature = "driver")]
    /// The scheduler is responsible for mapping idle and active [`Driver`] instances
    /// to threads.
    ///
    /// If set to None, then songbird will use [`get_default_scheduler`].
    ///
    /// [`Driver`]: crate::Driver
    pub scheduler: Option<Scheduler>,

    // Test only attributes
    #[cfg(feature = "driver")]
    #[cfg(test)]
    /// Test config to offer precise control over mixing tick rate/count.
    pub(crate) tick_style: TickStyle,
    #[cfg(feature = "driver")]
    #[cfg(test)]
    /// If set, skip connection and encryption steps.
    pub(crate) override_connection: Option<OutputMode>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            #[cfg(feature = "driver")]
            crypto_mode: CryptoMode::Aes256Gcm,
            #[cfg(all(feature = "driver", feature = "receive"))]
            decode_mode: DecodeMode::Decrypt,
            #[cfg(all(feature = "driver", feature = "receive"))]
            decode_state_timeout: Duration::from_secs(60).into(),
            #[cfg(all(feature = "driver", feature = "receive"))]
            playout_buffer_length: NonZeroU8::new(5).unwrap(),
            #[cfg(all(feature = "driver", feature = "receive"))]
            playout_spike_length: 3,
            #[cfg(feature = "gateway")]
            gateway_timeout: Some(Duration::from_secs(10).into()),
            #[cfg(feature = "driver")]
            mix_mode: MixMode::Stereo,
            #[cfg(feature = "driver")]
            preallocated_tracks: 1,
            #[cfg(feature = "driver")]
            use_softclip: true,
            #[cfg(feature = "driver")]
            driver_retry: Retry::default(),
            #[cfg(feature = "driver")]
            driver_timeout: Some(Duration::from_secs(10).into()),
            #[cfg(feature = "driver")]
            codec_registry: get_codec_registry(),
            #[cfg(feature = "driver")]
            format_registry: get_probe(),
            #[cfg(feature = "driver")]
            disposer: None,
            #[cfg(feature = "driver")]
            scheduler: None,
            #[cfg(feature = "driver")]
            #[cfg(test)]
            tick_style: TickStyle::Timed,
            #[cfg(feature = "driver")]
            #[cfg(test)]
            override_connection: None,
        }
    }
}

#[cfg(feature = "driver")]
impl Config {
    /// Sets this `Config`'s chosen cryptographic tagging scheme.
    #[must_use]
    pub fn crypto_mode(mut self, crypto_mode: CryptoMode) -> Self {
        self.crypto_mode = crypto_mode;
        self
    }

    #[cfg(feature = "receive")]
    /// Sets this `Config`'s received packet decryption/decoding behaviour.
    #[must_use]
    pub fn decode_mode(mut self, decode_mode: DecodeMode) -> Self {
        self.decode_mode = decode_mode;
        self
    }

    #[cfg(feature = "receive")]
    /// Sets this `Config`'s received packet decoder cleanup timer.
    #[must_use]
    pub fn decode_state_timeout(mut self, decode_state_timeout: Duration) -> Self {
        self.decode_state_timeout = decode_state_timeout.into();
        self
    }

    #[cfg(feature = "receive")]
    /// Sets this `Config`'s playout buffer length, in packets.
    #[must_use]
    pub fn playout_buffer_length(mut self, playout_buffer_length: NonZeroU8) -> Self {
        self.playout_buffer_length = playout_buffer_length;
        self
    }

    #[cfg(feature = "receive")]
    /// Sets this `Config`'s additional pre-allocated space to handle bursty audio packets.
    #[must_use]
    pub fn playout_spike_length(mut self, playout_spike_length: u8) -> Self {
        self.playout_spike_length = playout_spike_length;
        self
    }

    /// Sets this `Config`'s audio mixing channel count.
    #[must_use]
    pub fn mix_mode(mut self, mix_mode: MixMode) -> Self {
        self.mix_mode = mix_mode;
        self
    }

    /// Sets this `Config`'s number of tracks to preallocate.
    #[must_use]
    pub fn preallocated_tracks(mut self, preallocated_tracks: u8) -> Self {
        self.preallocated_tracks = preallocated_tracks;
        self
    }

    /// Sets this `Config`'s number to enable/disable soft-clipping sent audio.
    #[must_use]
    pub fn use_softclip(mut self, use_softclip: bool) -> Self {
        self.use_softclip = use_softclip;
        self
    }

    /// Sets this `Config`'s timeout for establishing a voice connection.
    #[must_use]
    pub fn driver_timeout(mut self, driver_timeout: Option<Duration>) -> Self {
        self.driver_timeout = driver_timeout.map(Into::into);
        self
    }

    /// Sets this `Config`'s voice connection retry configuration.
    #[must_use]
    pub fn driver_retry(mut self, driver_retry: Retry) -> Self {
        self.driver_retry = driver_retry;
        self
    }

    /// Sets this `Config`'s symphonia codec registry.
    #[must_use]
    pub fn codec_registry(mut self, codec_registry: &'static CodecRegistry) -> Self {
        self.codec_registry = codec_registry;
        self
    }

    /// Sets this `Config`'s symphonia format registry/probe set.
    #[must_use]
    pub fn format_registry(mut self, format_registry: &'static Probe) -> Self {
        self.format_registry = format_registry;
        self
    }

    /// Sets this `Config`'s channel for sending disposal messages.
    #[must_use]
    pub fn disposer(mut self, disposer: DisposalThread) -> Self {
        self.disposer = Some(disposer);
        self
    }

    /// Sets this `Config`'s mixer scheduler.
    #[must_use]
    pub fn scheduler(mut self, scheduler: Scheduler) -> Self {
        self.scheduler = Some(scheduler);
        self
    }

    /// Returns a lightweight reference to the audio scheduler this `Config` will use.
    #[must_use]
    pub fn get_scheduler(&self) -> Scheduler {
        self.scheduler
            .as_ref()
            .unwrap_or(get_default_scheduler())
            .clone()
    }

    /// Ensures a global disposer has been set, initializing one if not.
    #[must_use]
    pub(crate) fn initialise_disposer(self) -> Self {
        if self.disposer.is_some() {
            self
        } else {
            self.disposer(DisposalThread::run())
        }
    }

    /// This is used to prevent changes which would invalidate the current session.
    pub(crate) fn make_safe(&mut self, previous: &Config, connected: bool) {
        if connected {
            self.crypto_mode = previous.crypto_mode;
        }
    }
}

#[cfg(not(feature = "driver"))]
impl Config {
    pub(crate) fn initialise_disposer(self) -> Self {
        self
    }
}

// Test only attributes
#[cfg(all(test, feature = "driver"))]
#[allow(missing_docs)]
impl Config {
    #[must_use]
    pub fn tick_style(mut self, tick_style: TickStyle) -> Self {
        self.tick_style = tick_style;
        self
    }

    /// Sets this `Config`'s voice connection retry configuration.
    #[must_use]
    pub fn override_connection(mut self, override_connection: Option<OutputMode>) -> Self {
        self.override_connection = override_connection;
        self
    }

    #[must_use]
    pub fn test_cfg(raw_output: bool) -> (DriverTestHandle, Config) {
        let (tick_tx, tick_rx) = flume::unbounded();

        let (conn, rx) = if raw_output {
            let (pkt_tx, pkt_rx) = flume::unbounded();

            (OutputMode::Raw(pkt_tx), OutputReceiver::Raw(pkt_rx))
        } else {
            let (rtp_tx, rtp_rx) = flume::unbounded();

            (OutputMode::Rtp(rtp_tx), OutputReceiver::Rtp(rtp_rx))
        };

        let sc_config = SchedulerConfig {
            strategy: crate::driver::SchedulerMode::MaxPerThread(1.try_into().unwrap()),
            move_expensive_tasks: true,
        };

        let config = Config::default()
            .tick_style(TickStyle::UntimedWithExecLimit(tick_rx))
            // give each test its own thread in the scheduler for simplicity.
            .scheduler(Scheduler::new(sc_config))
            .override_connection(Some(conn));

        let handle = DriverTestHandle { rx, tx: tick_tx };

        (handle, config)
    }
}

#[cfg(feature = "gateway")]
impl Config {
    /// Sets this `Config`'s timeout for joining a voice channel.
    #[must_use]
    pub fn gateway_timeout(mut self, gateway_timeout: Option<Duration>) -> Self {
        self.gateway_timeout = gateway_timeout.map(Into::into);
        self
    }
}
