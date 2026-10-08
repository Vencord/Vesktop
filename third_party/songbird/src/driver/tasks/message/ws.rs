#![allow(missing_docs)]

use super::Interconnect;
use crate::{model::Event as GatewayEvent, ws::WsStream};

pub enum WsMessage {
    Ws(Box<WsStream>),
    ReplaceInterconnect(Interconnect),
    SetKeepalive(f64),
    Speaking(bool),
    Deliver(GatewayEvent),
    /// FastDiscord patch: seed the MLS-recognized roster from the client's
    /// own gateway view (user accounts get no op 11 ClientsConnect).
    SetRecognizedUsers(Vec<crate::model::id::UserId>),
}
