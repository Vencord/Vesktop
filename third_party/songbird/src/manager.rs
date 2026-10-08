#[cfg(feature = "serenity")]
use crate::shards::SerenitySharder;
use crate::{
    error::{JoinError, JoinResult},
    id::{ChannelId, GuildId, UserId},
    shards::Sharder,
    Call,
    Config,
    ConnectionInfo,
};
#[cfg(feature = "serenity")]
use async_trait::async_trait;
use dashmap::DashMap;
#[cfg(feature = "serenity")]
use futures::channel::mpsc::UnboundedSender as Sender;
use parking_lot::RwLock as PRwLock;
#[cfg(feature = "serenity")]
use serenity::{
    gateway::{ShardRunnerMessage, VoiceGatewayManager},
    model::{
        id::{GuildId as SerenityGuild, UserId as SerenityUser},
        voice::VoiceState,
    },
};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
#[cfg(feature = "serenity")]
use tracing::debug;
#[cfg(feature = "twilight")]
use twilight_model::gateway::event::Event as TwilightEvent;

#[derive(Clone, Copy, Debug)]
struct ClientData {
    shard_count: u64,
    user_id: UserId,
}

/// A shard-aware struct responsible for managing [`Call`]s.
///
/// This manager transparently maps guild state and a source of shard information
/// into individual calls, and forwards state updates which affect call state.
///
/// [`Call`]: Call
#[derive(Debug)]
pub struct Songbird {
    client_data: OnceLock<ClientData>,
    calls: DashMap<GuildId, Arc<Mutex<Call>>>,
    sharder: Sharder,
    config: PRwLock<Config>,
}

impl Songbird {
    #[cfg(feature = "serenity")]
    /// Create a new Songbird instance for serenity.
    ///
    /// This must be [registered] after creation.
    ///
    /// [registered]: crate::serenity::register_with
    #[must_use]
    pub fn serenity() -> Arc<Self> {
        Self::serenity_from_config(Config::default())
    }

    #[cfg(feature = "serenity")]
    /// Create a new Songbird instance for serenity, using the given configuration.
    ///
    /// This must be [registered] after creation.
    ///
    /// [registered]: crate::serenity::register_with
    #[must_use]
    pub fn serenity_from_config(config: Config) -> Arc<Self> {
        Arc::new(Self {
            client_data: OnceLock::new(),
            calls: DashMap::new(),
            sharder: Sharder::Serenity(SerenitySharder::default()),
            config: config.initialise_disposer().into(),
        })
    }

    #[cfg(feature = "twilight")]
    /// Create a new Songbird instance for twilight.
    ///
    /// Twilight handlers do not need to be registered, but
    /// users are responsible for passing in any events using
    /// [`process`].
    ///
    /// [`process`]: Songbird::process
    pub fn twilight<U>(cluster: Arc<crate::shards::TwilightMap>, user_id: U) -> Self
    where
        U: Into<UserId>,
    {
        Self::twilight_from_config(cluster, user_id, Config::default())
    }

    #[cfg(feature = "twilight")]
    /// Create a new Songbird instance for twilight.
    ///
    /// Twilight handlers do not need to be registered, but
    /// users are responsible for passing in any events using
    /// [`process`].
    ///
    /// [`process`]: Songbird::process
    pub fn twilight_from_config<U>(
        sender_map: Arc<crate::shards::TwilightMap>,
        user_id: U,
        config: Config,
    ) -> Self
    where
        U: Into<UserId>,
    {
        Self {
            client_data: OnceLock::from(ClientData {
                shard_count: sender_map.shard_count(),
                user_id: user_id.into(),
            }),
            calls: DashMap::new(),
            sharder: Sharder::Twilight(sender_map),
            config: config.initialise_disposer().into(),
        }
    }

    /// Set the bot's user, and the number of shards in use.
    ///
    /// If this struct is already initialised (e.g., from [`::twilight`]),
    /// or a previous call, then this function is a no-op.
    ///
    /// [`::twilight`]: #method.twilight
    pub fn initialise_client_data<U: Into<UserId>>(&self, shard_count: u64, user_id: U) {
        self.client_data
            .set(ClientData {
                shard_count,
                user_id: user_id.into(),
            })
            .ok();
    }

    /// Retrieves a [`Call`] for the given guild, if one already exists.
    ///
    /// [`Call`]: Call
    pub fn get<G: Into<GuildId>>(&self, guild_id: G) -> Option<Arc<Mutex<Call>>> {
        self.calls
            .get(&guild_id.into())
            .map(|mapref| Arc::clone(&mapref))
    }

    /// Retrieves a [`Call`] for the given guild, creating a new one if
    /// none is found.
    ///
    /// This will not join any calls, or cause connection state to change.
    ///
    /// [`Call`]: Call
    #[inline]
    pub fn get_or_insert<G>(&self, guild_id: G) -> Arc<Mutex<Call>>
    where
        G: Into<GuildId>,
    {
        self.get_or_insert_inner(guild_id.into())
    }

    fn get_or_insert_inner(&self, guild_id: GuildId) -> Arc<Mutex<Call>> {
        self.calls
            .entry(guild_id)
            .or_insert_with(|| {
                let info = self
                    .client_data
                    .get()
                    .expect("Manager has not been initialised");

                let shard = shard_id(guild_id.0.get(), info.shard_count);
                let shard_handle = self
                    .sharder
                    .get_shard(shard)
                    .expect("Failed to get shard handle: shard_count incorrect?");

                let call = Call::from_config(
                    guild_id,
                    shard_handle,
                    info.user_id,
                    self.config.read().clone(),
                );

                Arc::new(Mutex::new(call))
            })
            .clone()
    }

    /// Creates an iterator for all [`Call`]s currently managed.
    pub fn iter(&self) -> Iter<'_> {
        Iter {
            inner: self.calls.iter().map(|x| (*x.key(), Arc::clone(x.value()))),
        }
    }

    /// Sets a shared configuration for all drivers created from this
    /// manager.
    ///
    /// Changes made here will apply to new Call and Driver instances only.
    ///
    /// Requires the `"driver"` feature.
    pub fn set_config(&self, new_config: Config) {
        let mut config = self.config.write();
        *config = new_config;
    }

    #[cfg(feature = "driver")]
    /// Connects to a target by retrieving its relevant [`Call`] and
    /// connecting, or creating the handler if required.
    ///
    /// This can also switch to the given channel, if a handler already exists
    /// for the target and the current connected channel is not equal to the
    /// given channel.
    ///
    /// The provided channel ID is used as a connection target. The
    /// channel _must_ be in the provided guild. This is _not_ checked by the
    /// library, and will result in an error. If there is already a connected
    /// handler for the guild, _and_ the provided channel is different from the
    /// channel that the connection is already connected to, then the handler
    /// will switch the connection to the provided channel.
    ///
    /// If you _only_ need to retrieve the handler for a target, then use
    /// [`get`].
    ///
    /// Twilight users should read the caveats mentioned in [`process`].
    ///
    /// NOTE: an `Err(..)` value will still create a [`Call`] accessible via [`get`].
    ///
    /// [`Call`]: Call
    /// [`get`]: Songbird::get
    /// [`process`]: #method.process
    #[inline]
    pub async fn join<C, G>(&self, guild_id: G, channel_id: C) -> JoinResult<Arc<Mutex<Call>>>
    where
        C: Into<ChannelId>,
        G: Into<GuildId>,
    {
        self.join_inner(guild_id.into(), channel_id.into()).await
    }

    #[cfg(feature = "driver")]
    async fn join_inner(
        &self,
        guild_id: GuildId,
        channel_id: ChannelId,
    ) -> JoinResult<Arc<Mutex<Call>>> {
        let call = self.get_or_insert(guild_id);

        let stage_1 = {
            let mut handler = call.lock().await;
            handler.join(channel_id).await
        };

        match stage_1 {
            Ok(chan) => chan.await.map(|()| call),
            Err(e) => Err(e),
        }
    }

    /// Partially connects to a target by retrieving its relevant [`Call`] and
    /// connecting, or creating the handler if required.
    ///
    /// This method returns the handle and the connection info needed for other libraries
    /// or drivers, such as lavalink, and does not actually start or run a voice call.
    ///
    /// NOTE: an `Err(..)` value will still create a [`Call`] accessible via [`get`].
    ///
    /// [`Call`]: Call
    /// [`get`]: Songbird::get
    #[inline]
    pub async fn join_gateway<C, G>(
        &self,
        guild_id: G,
        channel_id: C,
    ) -> JoinResult<(ConnectionInfo, Arc<Mutex<Call>>)>
    where
        C: Into<ChannelId>,
        G: Into<GuildId>,
    {
        self.join_gateway_inner(guild_id.into(), channel_id.into())
            .await
    }

    async fn join_gateway_inner(
        &self,
        guild_id: GuildId,
        channel_id: ChannelId,
    ) -> JoinResult<(ConnectionInfo, Arc<Mutex<Call>>)> {
        let call = self.get_or_insert(guild_id);

        let stage_1 = {
            let mut handler = call.lock().await;
            handler.join_gateway(channel_id).await
        };

        match stage_1 {
            Ok(chan) => chan
                .await
                .map_err(|_| JoinError::Dropped)
                .map(|info| (info, call)),
            Err(e) => Err(e),
        }
    }

    /// Retrieves the [handler][`Call`] for the given target and leaves the
    /// associated voice channel, if connected.
    ///
    /// This will _not_ drop the handler, and will preserve it and its settings.
    /// If you do not need to reuse event handlers, configuration, or active tracks
    /// in the underlying driver *consider calling [`remove`]* to release tasks,
    /// threads, and memory.
    ///
    /// This is a wrapper around [getting][`get`] a handler and calling
    /// [`leave`] on it.
    ///
    /// [`Call`]: Call
    /// [`get`]: Songbird::get
    /// [`leave`]: Call::leave
    /// [`remove`]: Songbird::remove
    #[inline]
    pub async fn leave<G: Into<GuildId>>(&self, guild_id: G) -> JoinResult<()> {
        self.leave_inner(guild_id.into()).await
    }

    async fn leave_inner(&self, guild_id: GuildId) -> JoinResult<()> {
        if let Some(call) = self.get(guild_id) {
            let mut handler = call.lock().await;
            handler.leave().await
        } else {
            Err(JoinError::NoCall)
        }
    }

    /// Retrieves the [`Call`] for the given target and leaves the associated
    /// voice channel, if connected.
    ///
    /// The handler is then dropped, removing settings for the target.
    ///
    /// An Err(...) value implies that the gateway could not be contacted,
    /// and that leaving should be attempted again later (i.e., after reconnect).
    ///
    /// [`Call`]: Call
    #[inline]
    pub async fn remove<G: Into<GuildId>>(&self, guild_id: G) -> JoinResult<()> {
        self.remove_inner(guild_id.into()).await
    }

    async fn remove_inner(&self, guild_id: GuildId) -> JoinResult<()> {
        self.leave(guild_id).await?;
        self.calls.remove(&guild_id);
        Ok(())
    }
}

impl<'a> IntoIterator for &'a Songbird {
    type Item = <Iter<'a> as Iterator>::Item;

    type IntoIter = Iter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

#[cfg(feature = "twilight")]
impl Songbird {
    /// Handle events received on the cluster.
    ///
    /// When using twilight, you are required to call this with all inbound
    /// (voice) events, *i.e.*, at least `VoiceStateUpdate`s and `VoiceServerUpdate`s.
    ///
    /// Users *must* ensure that calls to this function happen on a **separate task**
    /// to any calls to [`join`], [`join_gateway`]. The simplest way to ensure this is
    /// to `tokio::spawn` any command invocation.
    ///
    /// Returned futures generally require the inner [`Call`] to be updated via this function,
    /// and will deadlock if event processing is not carried out on another spawned task.
    ///
    /// [`join`]: Songbird::join
    /// [`join_gateway`]: Songbird::join_gateway
    /// [`Call`]: Call
    pub async fn process(&self, event: &TwilightEvent) {
        match event {
            TwilightEvent::VoiceServerUpdate(v) => {
                let guild_id = GuildId::from(v.guild_id);
                let call = self.get(guild_id);

                if let Some(call) = call {
                    let mut handler = call.lock().await;
                    if let Some(endpoint) = &v.endpoint {
                        handler.update_server(endpoint.clone(), v.token.clone());
                    }
                }
            },
            TwilightEvent::VoiceStateUpdate(v) => {
                if self
                    .client_data
                    .get()
                    .map_or(true, |data| v.0.user_id.into_nonzero() != data.user_id.0)
                {
                    return;
                }

                let call = v.0.guild_id.map(GuildId::from).and_then(|id| self.get(id));

                if let Some(call) = call {
                    let mut handler = call.lock().await;
                    handler.update_state(v.0.session_id.clone(), v.0.channel_id);
                }
            },
            _ => {},
        }
    }
}

#[cfg(feature = "serenity")]
#[async_trait]
impl VoiceGatewayManager for Songbird {
    async fn initialise(&self, shard_count: u32, user_id: SerenityUser) {
        debug!(
            "Initialising Songbird for Serenity: ID {:?}, {} Shards",
            user_id, shard_count
        );
        self.initialise_client_data(shard_count as u64, user_id);
        debug!("Songbird ({:?}) Initialised!", user_id);
    }

    async fn register_shard(&self, shard_id: u32, sender: Sender<ShardRunnerMessage>) {
        debug!(
            "Registering Serenity shard handle {} with Songbird",
            shard_id
        );
        self.sharder.register_shard_handle(shard_id, sender);
        debug!("Registered shard handle {}.", shard_id);
    }

    async fn deregister_shard(&self, shard_id: u32) {
        debug!(
            "Deregistering Serenity shard handle {} with Songbird",
            shard_id
        );
        self.sharder.deregister_shard_handle(shard_id);
        debug!("Deregistered shard handle {}.", shard_id);
    }

    async fn server_update(&self, guild_id: SerenityGuild, endpoint: &Option<String>, token: &str) {
        if let Some(call) = self.get(guild_id) {
            let mut handler = call.lock().await;
            if let Some(endpoint) = endpoint {
                handler.update_server(endpoint.clone(), token.to_string());
            }
        }
    }

    async fn state_update(&self, guild_id: SerenityGuild, voice_state: &VoiceState) {
        if self.client_data.get().map_or(true, |data| {
            voice_state.user_id.get() != data.user_id.0.get()
        }) {
            return;
        }

        if let Some(call) = self.get(guild_id) {
            let mut handler = call.lock().await;
            handler.update_state(voice_state.session_id.clone(), voice_state.channel_id);
        }
    }
}

type DashMapIter<'a> = dashmap::iter::Iter<'a, GuildId, Arc<Mutex<Call>>>;
type InnerIter<'a> = std::iter::Map<
    DashMapIter<'a>,
    fn(<DashMapIter<'a> as Iterator>::Item) -> (GuildId, Arc<Mutex<Call>>),
>;

/// An iterator over all [`Call`]s currently stored in the manager instance.
pub struct Iter<'a> {
    inner: InnerIter<'a>,
}

impl Iterator for Iter<'_> {
    type Item = (GuildId, Arc<Mutex<Call>>);

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }

    fn count(self) -> usize {
        self.inner.count()
    }

    fn fold<B, F>(self, init: B, f: F) -> B
    where
        Self: Sized,
        F: FnMut(B, Self::Item) -> B,
    {
        self.inner.fold(init, f)
    }
}

#[inline]
fn shard_id(guild_id: u64, shard_count: u64) -> u64 {
    (guild_id >> 22) % shard_count
}
