//! Handlers for sending packets over sharded connections.

use crate::{error::JoinResult, id::*};
use async_trait::async_trait;
#[cfg(feature = "serenity")]
use dashmap::DashMap;
use derivative::Derivative;
#[cfg(feature = "serenity")]
use futures::channel::mpsc::{TrySendError, UnboundedSender as Sender};
#[cfg(feature = "serenity")]
use parking_lot::{lock_api::RwLockWriteGuard, Mutex as PMutex, RwLock as PRwLock};
#[cfg(feature = "serenity")]
use serde_json::json;
#[cfg(feature = "serenity")]
use serenity::gateway::ShardRunnerMessage;
#[cfg(feature = "serenity")]
use std::result::Result as StdResult;
use std::sync::Arc;
#[cfg(feature = "serenity")]
use tracing::{debug, error};
#[cfg(feature = "twilight")]
use twilight_gateway::MessageSender;
#[cfg(feature = "twilight")]
use twilight_model::gateway::payload::outgoing::update_voice_state::UpdateVoiceState as TwilightVoiceState;

/// Map containing [`MessageSender`]s for Twilight.
///
/// [`MessageSender`]: twilight_gateway::MessageSender
#[cfg(feature = "twilight")]
#[derive(Debug)]
pub struct TwilightMap {
    map: std::collections::HashMap<u32, MessageSender>,
}

#[cfg(feature = "twilight")]
impl TwilightMap {
    /// Construct a map of shards and command senders to those shards.
    ///
    /// For correctness all shards should be in the map.
    #[must_use]
    pub fn new(map: std::collections::HashMap<u32, MessageSender>) -> Self {
        TwilightMap { map }
    }

    /// Get the message sender for `shard_id`.
    #[must_use]
    pub fn get(&self, shard_id: u32) -> Option<&MessageSender> {
        self.map.get(&shard_id)
    }

    /// Get the total number of shards in the map.
    #[must_use]
    pub fn shard_count(&self) -> u64 {
        self.map.len() as u64
    }
}

#[derive(Derivative)]
#[derivative(Debug)]
#[non_exhaustive]
/// Source of individual shard connection handles.
pub enum Sharder {
    #[cfg(feature = "serenity")]
    /// Serenity-specific wrapper for sharder state initialised by the library.
    Serenity(SerenitySharder),
    #[cfg(feature = "twilight")]
    /// Twilight-specific wrapper for a map of command senders.
    Twilight(Arc<TwilightMap>),
    /// A generic shard handle source.
    Generic(#[derivative(Debug = "ignore")] Arc<dyn GenericSharder + Send + Sync>),
}

/// Trait for a generic shard cluster or other handle source.
///
/// This allows any Discord library to be integrated with Songbird, and offers a source
/// of generic shard handles.
#[async_trait]
pub trait GenericSharder {
    /// Get access to a new shard
    fn get_shard(&self, shard_id: u64) -> Option<Arc<dyn VoiceUpdate + Send + Sync>>;
}

impl Sharder {
    /// Returns a new handle to the required inner shard.
    #[allow(clippy::must_use_candidate)] // get_or_insert_shard_handle has side effects
    pub fn get_shard(&self, shard_id: u64) -> Option<Shard> {
        match self {
            #[cfg(feature = "serenity")]
            Sharder::Serenity(s) => Some(Shard::Serenity(
                s.get_or_insert_shard_handle(shard_id as u32),
            )),
            #[cfg(feature = "twilight")]
            Sharder::Twilight(t) => Some(Shard::Twilight(t.clone(), shard_id as u32)),
            Sharder::Generic(src) => src.get_shard(shard_id).map(Shard::Generic),
        }
    }
}

#[cfg(feature = "serenity")]
impl Sharder {
    #[allow(unreachable_patterns)]
    pub(crate) fn register_shard_handle(&self, shard_id: u32, sender: Sender<ShardRunnerMessage>) {
        if let Sharder::Serenity(s) = self {
            s.register_shard_handle(shard_id, sender);
        } else {
            error!("Called serenity management function on a non-serenity Songbird instance.");
        }
    }

    #[allow(unreachable_patterns)]
    pub(crate) fn deregister_shard_handle(&self, shard_id: u32) {
        if let Sharder::Serenity(s) = self {
            s.deregister_shard_handle(shard_id);
        } else {
            error!("Called serenity management function on a non-serenity Songbird instance.");
        }
    }
}

#[cfg(feature = "serenity")]
#[derive(Debug, Default)]
/// Serenity-specific wrapper for sharder state initialised by the library.
///
/// This is updated and maintained by the library, and is designed to prevent
/// message loss during rebalances and reconnects.
pub struct SerenitySharder(DashMap<u32, Arc<SerenityShardHandle>>);

#[cfg(feature = "serenity")]
impl SerenitySharder {
    fn get_or_insert_shard_handle(&self, shard_id: u32) -> Arc<SerenityShardHandle> {
        self.0.entry(shard_id).or_default().clone()
    }

    fn register_shard_handle(&self, shard_id: u32, sender: Sender<ShardRunnerMessage>) {
        // Write locks are only used to add new entries to the map.
        let handle = self.get_or_insert_shard_handle(shard_id);

        handle.register(sender);
    }

    fn deregister_shard_handle(&self, shard_id: u32) {
        // Write locks are only used to add new entries to the map.
        let handle = self.get_or_insert_shard_handle(shard_id);

        handle.deregister();
    }
}

#[derive(Derivative, Clone)]
#[derivative(Debug)]
#[non_exhaustive]
/// A reference to an individual websocket connection.
pub enum Shard {
    #[cfg(feature = "serenity")]
    /// Handle to one of serenity's shard runners.
    Serenity(Arc<SerenityShardHandle>),
    #[cfg(feature = "twilight")]
    /// Handle to a map of twilight command senders.
    Twilight(Arc<TwilightMap>, u32),
    /// Handle to a generic shard instance.
    Generic(#[derivative(Debug = "ignore")] Arc<dyn VoiceUpdate + Send + Sync>),
}

#[async_trait]
impl VoiceUpdate for Shard {
    async fn update_voice_state(
        &self,
        guild_id: GuildId,
        channel_id: Option<ChannelId>,
        self_deaf: bool,
        self_mute: bool,
    ) -> JoinResult<()> {
        match self {
            #[cfg(feature = "serenity")]
            Shard::Serenity(handle) => {
                let map = json!({
                    "op": 4,
                    "d": {
                        "channel_id": channel_id.map(|c| c.0),
                        "guild_id": guild_id.0,
                        "self_deaf": self_deaf,
                        "self_mute": self_mute,
                    }
                });

                handle.send(ShardRunnerMessage::Message(map.to_string().into()))?;
                Ok(())
            },
            #[cfg(feature = "twilight")]
            Shard::Twilight(map, shard_id) => {
                let channel_id = channel_id.map(|c| c.0).map(From::from);
                let cmd = TwilightVoiceState::new(guild_id.0, channel_id, self_deaf, self_mute);
                let sender = map
                    .get(*shard_id)
                    .ok_or(crate::error::JoinError::NoSender)?;
                sender.command(&cmd)?;
                Ok(())
            },
            Shard::Generic(g) =>
                g.update_voice_state(guild_id, channel_id, self_deaf, self_mute)
                    .await,
        }
    }
}

/// Trait for a generic shard handle to send voice state updates to Discord.
///
/// This allows any Discord library to be integrated with Songbird, and is intended to
/// wrap a message channel to a single shard. Songbird only needs to send `VoiceStateUpdate`s
/// to Discord to function.
///
/// Generic libraries must be sure to call [`Call::update_server`] and [`Call::update_state`]
/// in response to their own received messages.
///
/// [`Call::update_server`]: crate::Call::update_server
/// [`Call::update_state`]: crate::Call::update_state
#[async_trait]
pub trait VoiceUpdate {
    /// Send a voice update message to the inner shard handle.
    async fn update_voice_state(
        &self,
        guild_id: GuildId,
        channel_id: Option<ChannelId>,
        self_deaf: bool,
        self_mute: bool,
    ) -> JoinResult<()>;
}

#[cfg(feature = "serenity")]
/// Handle to an individual shard designed to buffer unsent messages while
/// a reconnect/rebalance is ongoing.
#[derive(Debug, Default)]
pub struct SerenityShardHandle {
    sender: PRwLock<Option<Sender<ShardRunnerMessage>>>,
    queue: PMutex<Vec<ShardRunnerMessage>>,
}

#[cfg(feature = "serenity")]
impl SerenityShardHandle {
    fn register(&self, sender: Sender<ShardRunnerMessage>) {
        debug!("Adding shard handle send channel...");

        let mut sender_lock = self.sender.write();
        *sender_lock = Some(sender);

        debug!("Added shard handle send channel.");

        let sender_lock = RwLockWriteGuard::downgrade(sender_lock);
        let mut messages_lock = self.queue.lock();

        debug!("Clearing queued messages...");

        if let Some(sender) = &*sender_lock {
            let mut i = 0;
            for msg in messages_lock.drain(..) {
                if let Err(e) = sender.unbounded_send(msg) {
                    error!("Error while clearing gateway message queue: {:?}", e);
                    break;
                }

                i += 1;
            }

            if i > 0 {
                debug!("{} buffered messages sent to Serenity.", i);
            }
        }

        debug!("Cleared queued messages.");
    }

    fn deregister(&self) {
        debug!("Removing shard handle send channel...");

        let mut sender_lock = self.sender.write();
        *sender_lock = None;

        debug!("Removed shard handle send channel.");
    }

    fn send(
        &self,
        message: ShardRunnerMessage,
    ) -> StdResult<(), Box<TrySendError<ShardRunnerMessage>>> {
        let sender_lock = self.sender.read();
        if let Some(sender) = &*sender_lock {
            sender.unbounded_send(message).map_err(Box::new)
        } else {
            debug!("Serenity shard temporarily disconnected: buffering message...");
            let mut messages_lock = self.queue.lock();
            messages_lock.push(message);
            debug!("Buffered message.");
            Ok(())
        }
    }
}
