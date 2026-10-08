//! Thin Discord REST client (API v10) for the endpoints the native client
//! uses. User-account tokens go in raw; bot tokens may be passed with their
//! `Bot ` prefix and are forwarded as-is.

use serde::de::DeserializeOwned;

use crate::model::{Channel, Guild, Member, Message, User};

pub const REST_BASE: &str = "https://discord.com/api/v10";
pub const USER_AGENT: &str = concat!(
    "FastDiscord/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/FelipeMayerDev/FastDiscord)"
);

pub const MESSAGES_PER_PAGE: u64 = 50;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("token inválido ou expirado")]
    Unauthorized,
    #[error("rate limit do Discord, tente em {0}s")]
    RateLimited(u64),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type ApiResult<T> = Result<T, ApiError>;

impl From<reqwest::Error> for ApiError {
    fn from(err: reqwest::Error) -> Self {
        ApiError::Other(err.into())
    }
}

pub struct Api {
    http: reqwest::Client,
    token: String,
}

impl Api {
    pub fn new(token: impl Into<String>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build the HTTP client");
        Self {
            http,
            token: token.into(),
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    async fn check_status(resp: reqwest::Response) -> ApiResult<reqwest::Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|value| value.get("retry_after").and_then(serde_json::Value::as_f64))
                .unwrap_or(1.0);
            return Err(ApiError::RateLimited(retry_after.ceil() as u64));
        }
        let body = resp.text().await.unwrap_or_default();
        Err(ApiError::Other(anyhow::anyhow!(
            "Discord API retornou {status}: {body}"
        )))
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> ApiResult<T> {
        let mut request = self
            .http
            .get(format!("{REST_BASE}{path}"))
            .header(reqwest::header::AUTHORIZATION, &self.token);
        if !query.is_empty() {
            request = request.query(query);
        }
        let resp = Self::check_status(request.send().await?).await?;
        Ok(resp.json::<T>().await?)
    }

    pub async fn gateway_url(&self) -> ApiResult<String> {
        #[derive(serde::Deserialize)]
        struct Gateway {
            url: String,
        }
        Ok(self.get_json::<Gateway>("/gateway", &[]).await?.url)
    }

    pub async fn me(&self) -> ApiResult<User> {
        self.get_json("/users/@me", &[]).await
    }

    pub async fn guilds(&self) -> ApiResult<Vec<Guild>> {
        self.get_json("/users/@me/guilds", &[]).await
    }

    pub async fn dm_channels(&self) -> ApiResult<Vec<Channel>> {
        self.get_json("/users/@me/channels", &[]).await
    }

    pub async fn guild_channels(&self, guild_id: &str) -> ApiResult<Vec<Channel>> {
        self.get_json(&format!("/guilds/{guild_id}/channels"), &[])
            .await
    }

    pub async fn messages(
        &self,
        channel_id: &str,
        before: Option<&str>,
    ) -> ApiResult<Vec<Message>> {
        let mut query = vec![("limit", MESSAGES_PER_PAGE.to_string())];
        if let Some(before) = before {
            query.push(("before", before.to_string()));
        }
        self.get_json(&format!("/channels/{channel_id}/messages"), &query)
            .await
    }

    pub async fn send_message(&self, channel_id: &str, content: &str) -> ApiResult<Message> {
        let resp = self
            .http
            .post(format!("{REST_BASE}/channels/{channel_id}/messages"))
            .header(reqwest::header::AUTHORIZATION, &self.token)
            .json(&serde_json::json!({ "content": content }))
            .send()
            .await?;
        Ok(Self::check_status(resp).await?.json::<Message>().await?)
    }

    /// Fire-and-forget typing indicator; Discord replies with an empty 204.
    pub async fn send_typing(&self, channel_id: &str) -> ApiResult<()> {
        let resp = self
            .http
            .post(format!("{REST_BASE}/channels/{channel_id}/typing"))
            .header(reqwest::header::AUTHORIZATION, &self.token)
            .send()
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// One guild member; used to name users that voice states only
    /// reference by id (READY seeds carry no member payload).
    pub async fn guild_member(&self, guild_id: &str, user_id: &str) -> ApiResult<Member> {
        self.get_json(&format!("/guilds/{guild_id}/members/{user_id}"), &[])
            .await
    }
}
