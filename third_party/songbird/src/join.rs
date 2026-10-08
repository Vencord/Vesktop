//! Future types for gateway interactions.

#[cfg(feature = "driver")]
use crate::error::ConnectionResult;
use crate::{
    error::{JoinError, JoinResult},
    ConnectionInfo,
};
use core::{
    convert,
    future::Future,
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};
use flume::r#async::RecvFut;
use pin_project::pin_project;
use tokio::time::{self, Timeout};

#[cfg(feature = "driver")]
/// Future for a call to [`Call::join`].
///
/// This future `await`s Discord's response *and*
/// connection via the [`Driver`]. Both phases have
/// separate timeouts and failure conditions.
///
/// This future ***must not*** be `await`ed while
/// holding the lock around a [`Call`].
///
/// [`Call::join`]: crate::Call::join
/// [`Call`]: crate::Call
/// [`Driver`]: crate::driver::Driver
#[pin_project]
pub struct Join {
    #[pin]
    gw: JoinClass<()>,
    #[pin]
    driver: JoinClass<ConnectionResult<()>>,
    state: JoinState,
}

#[cfg(feature = "driver")]
impl Join {
    pub(crate) fn new(
        driver: RecvFut<'static, ConnectionResult<()>>,
        gw_recv: RecvFut<'static, ()>,
        timeout: Option<Duration>,
    ) -> Self {
        Self {
            gw: JoinClass::new(gw_recv, timeout),
            driver: JoinClass::new(driver, None),
            state: JoinState::BeforeGw,
        }
    }
}

#[cfg(feature = "driver")]
impl Future for Join {
    type Output = JoinResult<()>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();

        if *this.state == JoinState::BeforeGw {
            let poll = this.gw.poll(cx);
            match poll {
                Poll::Ready(a) if a.is_ok() => {
                    *this.state = JoinState::AfterGw;
                },
                Poll::Ready(a) => {
                    *this.state = JoinState::Finalised;
                    return Poll::Ready(a);
                },
                Poll::Pending => return Poll::Pending,
            }
        }

        if *this.state == JoinState::AfterGw {
            let poll = this
                .driver
                .poll(cx)
                .map_ok(|res| res.map_err(JoinError::Driver))
                .map(|res| res.and_then(convert::identity));

            match poll {
                Poll::Ready(a) => {
                    *this.state = JoinState::Finalised;
                    return Poll::Ready(a);
                },
                Poll::Pending => return Poll::Pending,
            }
        }

        Poll::Pending
    }
}

#[cfg(feature = "driver")]
#[derive(Copy, Clone, Eq, PartialEq)]
enum JoinState {
    BeforeGw,
    AfterGw,
    Finalised,
}

/// Future for a call to [`Call::join_gateway`].
///
/// This future `await`s Discord's gateway response, subject
/// to any timeouts.
///
/// This future ***must not*** be `await`ed while
/// holding the lock around a [`Call`].
///
/// [`Call::join_gateway`]: crate::Call::join_gateway
/// [`Call`]: crate::Call
/// [`Driver`]: crate::driver::Driver
#[pin_project]
pub struct JoinGateway {
    #[pin]
    inner: JoinClass<ConnectionInfo>,
}

impl JoinGateway {
    pub(crate) fn new(recv: RecvFut<'static, ConnectionInfo>, timeout: Option<Duration>) -> Self {
        Self {
            inner: JoinClass::new(recv, timeout),
        }
    }
}

impl Future for JoinGateway {
    type Output = JoinResult<ConnectionInfo>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        self.project().inner.poll(cx)
    }
}

#[allow(clippy::large_enum_variant)]
#[pin_project(project = JoinClassProj)]
enum JoinClass<T: 'static> {
    WithTimeout(#[pin] Timeout<RecvFut<'static, T>>),
    Vanilla(RecvFut<'static, T>),
}

impl<T: 'static> JoinClass<T> {
    pub(crate) fn new(recv: RecvFut<'static, T>, timeout: Option<Duration>) -> Self {
        match timeout {
            Some(t) => JoinClass::WithTimeout(time::timeout(t, recv)),
            None => JoinClass::Vanilla(recv),
        }
    }
}

impl<T> Future for JoinClass<T>
where
    T: Unpin,
{
    type Output = JoinResult<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match self.project() {
            JoinClassProj::WithTimeout(t) => t
                .poll(cx)
                .map_err(|_| JoinError::TimedOut)
                .map_ok(|res| res.map_err(|_| JoinError::Dropped))
                .map(|m| m.and_then(convert::identity)),
            JoinClassProj::Vanilla(t) => Pin::new(t).poll(cx).map_err(|_| JoinError::Dropped),
        }
    }
}
