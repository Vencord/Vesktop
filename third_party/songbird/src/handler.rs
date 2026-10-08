#[cfg(feature = "driver")]
use crate::{driver::Driver, error::ConnectionResult};
use crate::{
    error::{JoinError, JoinResult},
    id::{ChannelId, GuildId, UserId},
    info::{ConnectionInfo, ConnectionProgress},
    join::*,
    shards::{Shard, VoiceUpdate},
    Config,
};
use flume::Sender;
use std::fmt::Debug;
use tracing::instrument;

#[cfg(feature = "driver")]
use std::ops::{Deref, DerefMut};

#[derive(Clone, Debug)]
enum Return {
    // Return the connection info as it is received.
    Info(Sender<ConnectionInfo>),

    // Two channels: first indicates "gateway connection" was successful,
    // second indicates that the driver successfully connected.
    // The first is needed to cancel a timeout as the driver can/should
    // have separate connection timing/retry config.
    #[cfg(feature = "driver")]
    Conn(Sender<()>, Sender<ConnectionResult<()>>),
}

/// The Call handler is responsible for a single voice connection, acting
/// as a clean API above the inner state and gateway message management.
///
/// If the `"driver"` feature is enabled, then a Call exposes all control methods of
/// [`Driver`] via `Deref(Mut)`.
///
/// [`Driver`]: struct@Driver
#[derive(Clone, Debug)]
pub struct Call {
    #[cfg(not(feature = "driver"))]
    config: Config,

    connection: Option<(ConnectionProgress, Return)>,

    #[cfg(feature = "driver")]
    /// The internal controller of the voice connection monitor thread.
    driver: Driver,

    guild_id: GuildId,
    /// Whether the current handler is set to deafen voice connections.
    self_deaf: bool,
    /// Whether the current handler is set to mute voice connections.
    self_mute: bool,
    user_id: UserId,
    /// Will be set when a `Call` is made via the [`new`]
    /// method.
    ///
    /// When set via [`standalone`](`Call::standalone`), it will not be
    /// present.
    ///
    /// [`new`]: Call::new
    /// [`standalone`]: Call::standalone
    ws: Option<Shard>,
}

impl Call {
    /// Creates a new Call, which will send out WebSocket messages via
    /// the given shard.
    #[inline]
    #[instrument]
    pub fn new<G, U>(guild_id: G, ws: Shard, user_id: U) -> Self
    where
        G: Into<GuildId> + Debug,
        U: Into<UserId> + Debug,
    {
        Self::new_raw_cfg(guild_id.into(), Some(ws), user_id.into(), Config::default())
    }

    /// Creates a new Call, configuring the driver as specified.
    #[inline]
    #[instrument]
    pub fn from_config<G, U>(guild_id: G, ws: Shard, user_id: U, config: Config) -> Self
    where
        G: Into<GuildId> + Debug,
        U: Into<UserId> + Debug,
    {
        Self::new_raw_cfg(guild_id.into(), Some(ws), user_id.into(), config)
    }

    /// Creates a new, standalone Call which is not connected via
    /// WebSocket to the Gateway.
    ///
    /// Actions such as muting, deafening, and switching channels will not
    /// function through this Call and must be done through some other
    /// method, as the values will only be internally updated.
    ///
    /// For most use cases you do not want this.
    #[inline]
    #[instrument]
    pub fn standalone<G, U>(guild_id: G, user_id: U) -> Self
    where
        G: Into<GuildId> + Debug,
        U: Into<UserId> + Debug,
    {
        Self::new_raw_cfg(guild_id.into(), None, user_id.into(), Config::default())
    }

    /// Creates a new standalone Call from the given configuration file.
    #[inline]
    #[instrument]
    pub fn standalone_from_config<G, U>(guild_id: G, user_id: U, config: Config) -> Self
    where
        G: Into<GuildId> + Debug,
        U: Into<UserId> + Debug,
    {
        Self::new_raw_cfg(guild_id.into(), None, user_id.into(), config)
    }

    fn new_raw_cfg(guild_id: GuildId, ws: Option<Shard>, user_id: UserId, config: Config) -> Self {
        Call {
            #[cfg(not(feature = "driver"))]
            config,
            connection: None,
            #[cfg(feature = "driver")]
            driver: Driver::new(config),
            guild_id,
            self_deaf: false,
            self_mute: false,
            user_id,
            ws,
        }
    }

    #[instrument(skip(self))]
    fn do_connect(&mut self) {
        match &self.connection {
            Some((ConnectionProgress::Complete(c), Return::Info(tx))) => {
                // It's okay if the receiver hung up.
                drop(tx.send(c.clone()));
            },
            #[cfg(feature = "driver")]
            Some((ConnectionProgress::Complete(c), Return::Conn(first_tx, driver_tx))) => {
                // It's okay if the receiver hung up.
                _ = first_tx.send(());

                self.driver.raw_connect(c.clone(), driver_tx.clone());
            },
            _ => {},
        }
    }

    /// Sets whether the current connection is to be deafened.
    ///
    /// If there is no live voice connection, then this only acts as a settings
    /// update for future connections.
    ///
    /// **Note**: Unlike in the official client, you _can_ be deafened while
    /// not being muted.
    ///
    /// **Note**: If the `Call` was created via [`standalone`], then this
    /// will _only_ update whether the connection is internally deafened.
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self))]
    pub async fn deafen(&mut self, deaf: bool) -> JoinResult<()> {
        self.self_deaf = deaf;

        self.update().await
    }

    /// Returns whether the current connection is self-deafened in this server.
    ///
    /// This is purely cosmetic.
    #[instrument(skip(self))]
    pub fn is_deaf(&self) -> bool {
        self.self_deaf
    }

    async fn should_actually_join<F, G>(
        &mut self,
        completion_generator: F,
        tx: &Sender<G>,
        channel_id: ChannelId,
    ) -> JoinResult<bool>
    where
        F: FnOnce(&Self) -> G,
    {
        Ok(if let Some(conn) = &self.connection {
            if conn.0.in_progress() {
                self.leave().await?;
                true
            } else if conn.0.channel_id() == channel_id {
                drop(tx.send(completion_generator(self)));
                false
            } else {
                // not in progress, and/or a channel change.
                true
            }
        } else {
            true
        })
    }

    #[cfg(feature = "driver")]
    /// Connect or switch to the given voice channel by its Id.
    ///
    /// This function acts as a future in two stages:
    /// * The first `await` sends the request over the gateway.
    /// * The second `await`s a the driver's connection attempt.
    ///   To prevent deadlock, any mutexes around this Call
    ///   *must* be released before this result is queried.
    ///
    /// When using [`Songbird::join`], this pattern is correctly handled for you.
    ///
    /// [`Songbird::join`]: crate::Songbird::join
    #[instrument(skip(self))]
    #[inline]
    pub async fn join<C>(&mut self, channel_id: C) -> JoinResult<Join>
    where
        C: Into<ChannelId> + Debug,
    {
        self.join_inner(channel_id.into()).await
    }

    #[cfg(feature = "driver")]
    async fn join_inner(&mut self, channel_id: ChannelId) -> JoinResult<Join> {
        let (tx, rx) = flume::unbounded();
        let (gw_tx, gw_rx) = flume::unbounded();

        let do_conn = self
            .should_actually_join(|_| (), &gw_tx, channel_id)
            .await?;

        if do_conn {
            self.connection = Some((
                ConnectionProgress::new(self.guild_id, self.user_id, channel_id),
                Return::Conn(gw_tx, tx),
            ));

            let timeout = self.config().gateway_timeout.map(Into::into);

            self.update()
                .await
                .map(|()| Join::new(rx.into_recv_async(), gw_rx.into_recv_async(), timeout))
        } else {
            // Skipping the gateway connection implies that the current connection is complete
            // AND the channel is a match.
            //
            // Send a polite request to the driver, which should only *actually* reconnect
            // if it had a problem earlier.
            let info = self.current_connection().unwrap().clone();
            self.driver.raw_connect(info, tx.clone());

            Ok(Join::new(
                rx.into_recv_async(),
                gw_rx.into_recv_async(),
                None,
            ))
        }
    }

    /// Join the selected voice channel, *without* running/starting an RTP
    /// session or running the driver.
    ///
    /// Use this if you require connection info for lavalink,
    /// some other voice implementation, or don't want to use the driver for a given call.
    ///
    /// This function acts as a future in two stages:
    /// * The first `await` sends the request over the gateway.
    /// * The second `await`s voice session data from Discord.
    ///   To prevent deadlock, any mutexes around this Call
    ///   *must* be released before this result is queried.
    ///
    /// When using [`Songbird::join_gateway`], this pattern is correctly handled for you.
    ///
    /// [`Songbird::join_gateway`]: crate::Songbird::join_gateway
    #[instrument(skip(self))]
    #[inline]
    pub async fn join_gateway<C>(&mut self, channel_id: C) -> JoinResult<JoinGateway>
    where
        C: Into<ChannelId> + Debug,
    {
        self.join_gateway_inner(channel_id.into()).await
    }

    async fn join_gateway_inner(&mut self, channel_id: ChannelId) -> JoinResult<JoinGateway> {
        let (tx, rx) = flume::unbounded();

        let do_conn = self
            .should_actually_join(
                |call| call.connection.as_ref().unwrap().0.info().unwrap(),
                &tx,
                channel_id,
            )
            .await?;

        if do_conn {
            self.connection = Some((
                ConnectionProgress::new(self.guild_id, self.user_id, channel_id),
                Return::Info(tx),
            ));

            let timeout = self.config().gateway_timeout.map(Into::into);

            self.update()
                .await
                .map(|()| JoinGateway::new(rx.into_recv_async(), timeout))
        } else {
            Ok(JoinGateway::new(rx.into_recv_async(), None))
        }
    }

    /// Returns the current voice connection details for this Call,
    /// if available.
    #[instrument(skip(self))]
    pub fn current_connection(&self) -> Option<&ConnectionInfo> {
        match &self.connection {
            Some((progress, _)) => progress.get_connection_info(),
            _ => None,
        }
    }

    /// Returns `id` of the channel, if connected or connecting to any.
    ///
    /// This remains set after a connection failure, to allow for reconnection
    /// as needed. This will change if moved into another voice channel by an
    /// admin, and will be unset if kicked from a voice channel.
    #[instrument(skip(self))]
    pub fn current_channel(&self) -> Option<ChannelId> {
        match &self.connection {
            Some((progress, _)) => Some(progress.channel_id()),
            _ => None,
        }
    }

    /// Leaves the current voice channel, disconnecting from it.
    ///
    /// This does _not_ forget settings, like whether to be self-deafened or
    /// self-muted.
    ///
    /// **Note**: If the `Call` was created via [`standalone`], then this
    /// will _only_ update whether the connection is internally connected to a
    /// voice channel.
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self))]
    pub async fn leave(&mut self) -> JoinResult<()> {
        self.leave_local();

        // Only send an update if we were in a voice channel.
        self.update().await
    }

    fn leave_local(&mut self) {
        self.connection = None;

        #[cfg(feature = "driver")]
        self.driver.leave();
    }

    /// Sets whether the current connection is to be muted.
    ///
    /// If there is no live voice connection, then this only acts as a settings
    /// update for future connections.
    ///
    /// **Note**: If the `Call` was created via [`standalone`], then this
    /// will _only_ update whether the connection is internally muted.
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self))]
    pub async fn mute(&mut self, mute: bool) -> JoinResult<()> {
        self.self_mute = mute;

        #[cfg(feature = "driver")]
        self.driver.mute(mute);

        self.update().await
    }

    /// Returns whether the current connection is self-muted in this server.
    #[instrument(skip(self))]
    pub fn is_mute(&self) -> bool {
        self.self_mute
    }

    /// Updates the voice server data.
    ///
    /// You should only need to use this if you initialized the `Call` via
    /// [`standalone`].
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self, token))]
    pub fn update_server(&mut self, endpoint: String, token: String) {
        let try_conn = if let Some((ref mut progress, _)) = self.connection.as_mut() {
            progress.apply_server_update(endpoint, token)
        } else {
            false
        };

        if try_conn {
            self.do_connect();
        }
    }

    /// Updates the internal voice state of the current user.
    ///
    /// You should only need to use this if you initialized the `Call` via
    /// [`standalone`].
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self))]
    #[inline]
    pub fn update_state<C>(&mut self, session_id: String, channel_id: Option<C>)
    where
        C: Into<ChannelId> + Debug,
    {
        self.update_state_inner(session_id, channel_id.map(Into::into));
    }

    fn update_state_inner(&mut self, session_id: String, channel_id: Option<ChannelId>) {
        if let Some(channel_id) = channel_id {
            let try_conn = if let Some((ref mut progress, _)) = self.connection.as_mut() {
                progress.apply_state_update(session_id, channel_id)
            } else {
                false
            };

            if try_conn {
                self.do_connect();
            }
        } else {
            // Likely that we were disconnected by an admin.
            self.leave_local();
        }
    }

    /// Send an update for the current session over WS.
    ///
    /// Does nothing if initialized via [`standalone`].
    ///
    /// [`standalone`]: Call::standalone
    #[instrument(skip(self))]
    async fn update(&mut self) -> JoinResult<()> {
        if let Some(ws) = self.ws.as_mut() {
            ws.update_voice_state(
                self.guild_id,
                self.connection.as_ref().map(|c| c.0.channel_id()),
                self.self_deaf,
                self.self_mute,
            )
            .await
        } else {
            Err(JoinError::NoSender)
        }
    }
}

#[cfg(not(feature = "driver"))]
impl Call {
    /// Access this call handler's configuration.
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Mutably access this call handler's configuration.
    pub fn config_mut(&mut self) -> &mut Config {
        &mut self.config
    }

    /// Set this call handler's configuration.
    pub fn set_config(&mut self, config: Config) {
        self.config = config;
    }
}

#[cfg(feature = "driver")]
impl Deref for Call {
    type Target = Driver;

    fn deref(&self) -> &Self::Target {
        &self.driver
    }
}

#[cfg(feature = "driver")]
impl DerefMut for Call {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.driver
    }
}
