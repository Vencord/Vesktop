use crate::{
    error::JsonError,
    model::{deserialize_binary_event, Event},
};

use bytes::Bytes;
use futures::{SinkExt, StreamExt, TryStreamExt};
use serenity_voice_model::{serialize_binary_event, BinaryError};
use tokio::{
    net::TcpStream,
    time::{timeout, Duration},
};
#[cfg(feature = "tungstenite")]
use tokio_tungstenite::{
    tungstenite::{
        error::Error as TungsteniteError,
        protocol::{CloseFrame, WebSocketConfig as Config},
        Message,
    },
    MaybeTlsStream,
    WebSocketStream,
};
#[cfg(feature = "tws")]
use tokio_websockets::{
    CloseCode,
    Error as TwsError,
    Limits,
    MaybeTlsStream,
    Message,
    WebSocketStream,
};
use tracing::{debug, instrument};
use url::Url;

pub struct WsStream(WebSocketStream<MaybeTlsStream<TcpStream>>);

impl WsStream {
    #[instrument]
    pub(crate) async fn connect(url: Url) -> Result<Self> {
        #[cfg(feature = "tungstenite")]
        let (stream, _) = tokio_tungstenite::connect_async_with_config::<Url>(
            url,
            Some(
                Config::default()
                    .max_message_size(None)
                    .max_frame_size(None),
            ),
            true,
        )
        .await?;
        #[cfg(feature = "tws")]
        let (stream, _) = tokio_websockets::ClientBuilder::new()
            .limits(Limits::unlimited())
            .uri(url.as_str())
            .unwrap() // Any valid URL is a valid URI.
            .connect()
            .await?;

        Ok(Self(stream))
    }

    pub(crate) async fn recv_event(&mut self) -> Result<Option<Event>> {
        const TIMEOUT: Duration = Duration::from_millis(500);

        let ws_message = match timeout(TIMEOUT, self.0.next()).await {
            Ok(Some(Ok(v))) => Some(v),
            Ok(Some(Err(e))) => return Err(e.into()),
            Ok(None) | Err(_) => None,
        };

        convert_ws_message(ws_message)
    }

    pub(crate) async fn recv_event_no_timeout(&mut self) -> Result<Option<Event>> {
        convert_ws_message(self.0.try_next().await?)
    }

    pub(crate) async fn send_json(&mut self, value: &Event) -> Result<()> {
        let res = crate::json::to_string(value);
        let res = res.map(Message::text);
        Ok(res.map_err(Error::from).map(|m| self.0.send(m))?.await?)
    }

    pub(crate) async fn send_binary(&mut self, value: &Event) -> Result<()> {
        let res = serialize_binary_event(value);
        let res = res.map(Message::binary);

        Ok(res.map_err(Error::from).map(|m| self.0.send(m))?.await?)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    Json(JsonError),

    /// The discord voice gateway does not support or offer zlib compression.
    /// As a result, only text messages are expected.
    UnexpectedBinaryMessage(Bytes),

    #[cfg(feature = "tungstenite")]
    Ws(Box<TungsteniteError>),
    #[cfg(feature = "tws")]
    Ws(TwsError),

    #[cfg(feature = "tungstenite")]
    WsClosed(Option<CloseFrame>),
    #[cfg(feature = "tws")]
    WsClosed(Option<CloseCode>),

    Binary(BinaryError),
}

impl From<JsonError> for Error {
    fn from(e: JsonError) -> Error {
        Error::Json(e)
    }
}

#[cfg(feature = "tungstenite")]
impl From<TungsteniteError> for Error {
    fn from(e: TungsteniteError) -> Error {
        Error::Ws(Box::new(e))
    }
}

#[cfg(feature = "tws")]
impl From<TwsError> for Error {
    fn from(e: TwsError) -> Self {
        Error::Ws(e)
    }
}

impl From<BinaryError> for Error {
    fn from(value: BinaryError) -> Self {
        Error::Binary(value)
    }
}

#[inline]
pub(crate) fn convert_ws_message(message: Option<Message>) -> Result<Option<Event>> {
    #[cfg(feature = "tungstenite")]
    match message {
        Some(Message::Text(ref payload)) =>
            return Ok(serde_json::from_str(payload)
                .map_err(|e| {
                    debug!("Unexpected JSON: {e}. Payload: {payload}");
                    e
                })
                .ok()),
        Some(Message::Binary(bytes)) => {
            return Ok(deserialize_binary_event(&bytes)
                .map_err(|e| {
                    debug!("Unexpected binary: {e}");
                    e
                })
                .ok());
        },
        Some(Message::Close(Some(frame))) => {
            return Err(Error::WsClosed(Some(frame)));
        },
        // Ping/Pong message behaviour is internally handled by tungstenite.
        _ => return Ok(None),
    };

    #[cfg(feature = "tws")]
    match message {
        Some(ref message) if message.is_text() => {
            return if let Some(text) = message.as_text() {
                Ok(serde_json::from_str(text)
                    .map_err(|e| {
                        debug!("Unexpected JSON: {e}. Payload: {text}");
                        e
                    })
                    .ok())
            } else {
                Ok(None)
            };
        },
        Some(message) if message.is_binary() => {
            return Ok(deserialize_binary_event(&message.into_payload())
                .map_err(|e| {
                    debug!("Unexpected binary: {e}");
                    e
                })
                .ok());
        },
        Some(message) if message.is_close() => {
            return Err(Error::WsClosed(message.as_close().map(|(c, _)| c)));
        },
        // ping/pong; will also be internally handled by tokio-websockets.
        _ => return Ok(None),
    };
}
