//! Newtypes around Discord IDs for library cross-compatibility.

#[cfg(feature = "driver")]
use crate::model::id::{GuildId as DriverGuild, UserId as DriverUser};
#[cfg(feature = "serenity")]
use serenity::model::id::{
    ChannelId as SerenityChannel,
    GuildId as SerenityGuild,
    UserId as SerenityUser,
};
use std::{
    fmt::{Display, Formatter, Result as FmtResult},
    num::NonZeroU64,
};
#[cfg(feature = "twilight")]
use twilight_model::id::{
    marker::{ChannelMarker, GuildMarker, UserMarker},
    Id as TwilightId,
};

/// ID of a Discord voice/text channel.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ChannelId(pub NonZeroU64);

/// ID of a Discord guild (colloquially, "server").
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GuildId(pub NonZeroU64);

/// ID of a Discord user.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct UserId(pub NonZeroU64);

impl Display for ChannelId {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        Display::fmt(&self.0, f)
    }
}

impl From<NonZeroU64> for ChannelId {
    fn from(id: NonZeroU64) -> Self {
        Self(id)
    }
}

#[cfg(feature = "serenity")]
impl From<SerenityChannel> for ChannelId {
    fn from(id: SerenityChannel) -> Self {
        Self(NonZeroU64::new(id.get()).unwrap())
    }
}

#[cfg(feature = "twilight")]
impl From<TwilightId<ChannelMarker>> for ChannelId {
    fn from(id: TwilightId<ChannelMarker>) -> Self {
        Self(id.into_nonzero())
    }
}

impl Display for GuildId {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        Display::fmt(&self.0, f)
    }
}

impl From<NonZeroU64> for GuildId {
    fn from(id: NonZeroU64) -> Self {
        Self(id)
    }
}

#[cfg(feature = "serenity")]
impl From<SerenityGuild> for GuildId {
    fn from(id: SerenityGuild) -> Self {
        Self(NonZeroU64::new(id.get()).unwrap())
    }
}

#[cfg(feature = "driver")]
impl From<GuildId> for DriverGuild {
    fn from(id: GuildId) -> Self {
        Self(id.0.get())
    }
}

#[cfg(feature = "twilight")]
impl From<TwilightId<GuildMarker>> for GuildId {
    fn from(id: TwilightId<GuildMarker>) -> Self {
        Self(id.into_nonzero())
    }
}

impl Display for UserId {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        Display::fmt(&self.0, f)
    }
}

impl From<NonZeroU64> for UserId {
    fn from(id: NonZeroU64) -> Self {
        Self(id)
    }
}

#[cfg(feature = "serenity")]
impl From<SerenityUser> for UserId {
    fn from(id: SerenityUser) -> Self {
        Self(NonZeroU64::new(id.get()).unwrap())
    }
}

#[cfg(feature = "driver")]
impl From<UserId> for DriverUser {
    fn from(id: UserId) -> Self {
        Self(id.0.get())
    }
}

#[cfg(feature = "twilight")]
impl From<TwilightId<UserMarker>> for UserId {
    fn from(id: TwilightId<UserMarker>) -> Self {
        Self(id.into_nonzero())
    }
}
