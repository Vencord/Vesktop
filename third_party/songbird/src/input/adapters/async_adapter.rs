use crate::input::AudioStreamError;
use async_trait::async_trait;
use flume::{Receiver, RecvError, Sender, TryRecvError};
use futures::{future::Either, stream::FuturesUnordered, FutureExt, StreamExt};
use parking_lot::Mutex;
use ringbuf::{storage::Heap, traits::*, *};
use std::{
    io::{
        Error as IoError,
        ErrorKind as IoErrorKind,
        Read,
        Result as IoResult,
        Seek,
        SeekFrom,
        Write,
    },
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use symphonia_core::io::MediaSource;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt},
    sync::Notify,
};

struct AsyncAdapterSink {
    bytes_in: HeapProd<u8>,
    req_rx: Receiver<AdapterRequest>,
    resp_tx: Sender<AdapterResponse>,
    stream: Box<dyn AsyncMediaSource>,
    notify_rx: Arc<Notify>,
}

impl AsyncAdapterSink {
    async fn launch(mut self) {
        let mut inner_buf = vec![0u8; 32 * 1024].into_boxed_slice();
        let mut read_region = 0..0;
        let mut hit_end = false;
        let mut blocked = false;
        let mut pause_buf_moves = false;
        let mut seek_res = None;
        let mut seen_bytes = 0;

        loop {
            // if read_region is empty, refill from src.
            //  if that read is zero, tell other half.
            // if WouldBlock, block on msg acquire,
            // else non_block msg acquire.

            if !pause_buf_moves {
                if !hit_end && read_region.is_empty() {
                    if let Ok(n) = self.stream.read(&mut inner_buf).await {
                        read_region = 0..n;
                        if n == 0 {
                            drop(self.resp_tx.send_async(AdapterResponse::ReadZero).await);
                            hit_end = true;
                        }
                        seen_bytes += n as u64;
                    } else {
                        match self.stream.try_resume(seen_bytes).await {
                            Ok(s) => {
                                self.stream = s;
                            },
                            Err(_e) => break,
                        }
                    }
                }

                while !read_region.is_empty() && !blocked {
                    if let Ok(n_moved) = self
                        .bytes_in
                        .write(&inner_buf[read_region.start..read_region.end])
                    {
                        read_region.start += n_moved;
                        drop(self.resp_tx.send_async(AdapterResponse::ReadOccurred).await);
                    } else {
                        blocked = true;
                    }
                }
            }

            let msg = if blocked || hit_end {
                let mut fs = FuturesUnordered::new();
                fs.push(Either::Left(self.req_rx.recv_async()));
                fs.push(Either::Right(self.notify_rx.notified().map(|()| {
                    let o: Result<AdapterRequest, RecvError> = Ok(AdapterRequest::Wake);
                    o
                })));

                match fs.next().await {
                    Some(Ok(a)) => a,
                    _ => break,
                }
            } else {
                match self.req_rx.try_recv() {
                    Ok(a) => a,
                    Err(TryRecvError::Empty) => continue,
                    _ => break,
                }
            };

            match msg {
                AdapterRequest::Wake => blocked = false,
                AdapterRequest::ByteLen => {
                    drop(
                        self.resp_tx
                            .send_async(AdapterResponse::ByteLen(self.stream.byte_len().await))
                            .await,
                    );
                },
                AdapterRequest::Seek(pos) => {
                    pause_buf_moves = true;
                    drop(self.resp_tx.send_async(AdapterResponse::SeekClear).await);
                    seek_res = Some(self.stream.seek(pos).await);
                },
                AdapterRequest::SeekCleared => {
                    if let Some(res) = seek_res.take() {
                        drop(
                            self.resp_tx
                                .send_async(AdapterResponse::SeekResult(res))
                                .await,
                        );
                    }
                    pause_buf_moves = false;
                },
            }
        }
    }
}

/// An adapter for converting an async media source into a synchronous one
/// usable by symphonia.
///
/// This adapter takes a source implementing `AsyncRead`, and allows the receive side to
/// pass along seek requests needed. This allows for passing bytes from exclusively `AsyncRead`
/// streams (e.g., hyper HTTP sessions) to Songbird.
pub struct AsyncAdapterStream {
    // Note: this mutex is here to appease symphonia's Send + Sync bound.
    // Only one thread should own and pull from this stream, so in practice
    // there is no contention.
    bytes_out: Mutex<HeapCons<u8>>,
    can_seek: bool,
    // Note: these are Atomic just to work around the need for
    // check_messages to take &self rather than &mut.
    finalised: AtomicBool,
    bytes_known_present: AtomicBool,
    req_tx: Sender<AdapterRequest>,
    resp_rx: Receiver<AdapterResponse>,
    notify_tx: Arc<Notify>,
}

impl AsyncAdapterStream {
    /// Wrap and pull from an async file stream, with an intermediate ring-buffer of size `buf_len`
    /// between the async and sync halves.
    #[must_use]
    pub fn new(stream: Box<dyn AsyncMediaSource>, buf_len: usize) -> AsyncAdapterStream {
        let (bytes_in, bytes_out) = SharedRb::<Heap<_>>::new(buf_len).split();
        let bytes_out = bytes_out.into();
        let (resp_tx, resp_rx) = flume::unbounded();
        let (req_tx, req_rx) = flume::unbounded();
        let can_seek = stream.is_seekable();
        let notify_rx = Arc::new(Notify::new());
        let notify_tx = notify_rx.clone();

        let sink = AsyncAdapterSink {
            bytes_in,
            req_rx,
            resp_tx,
            stream,
            notify_rx,
        };
        let stream = AsyncAdapterStream {
            bytes_out,
            can_seek,
            finalised: false.into(),
            bytes_known_present: false.into(),
            req_tx,
            resp_rx,
            notify_tx,
        };

        tokio::spawn(async move {
            Box::pin(sink.launch()).await;
        });

        stream
    }

    fn handle_messages(&self, op: Operation) -> Option<AdapterResponse> {
        loop {
            let msg = if op.will_block() {
                self.resp_rx.recv().ok()
            } else {
                self.resp_rx.try_recv().ok()
            };

            let Some(msg) = msg else { break None };

            // state changes
            match &msg {
                AdapterResponse::ReadZero => {
                    self.finalised.store(true, Ordering::Relaxed);
                },
                AdapterResponse::ReadOccurred => {
                    self.bytes_known_present.store(true, Ordering::Relaxed);
                },
                _ => {},
            }

            if op.expected_msg(&msg) {
                break Some(msg);
            }
        }
    }

    fn is_dropped_and_clear(&self) -> bool {
        self.resp_rx.is_empty() && self.resp_rx.is_disconnected()
    }

    fn check_dropped(&self) -> IoResult<()> {
        if self.is_dropped_and_clear() {
            Err(IoError::new(
                IoErrorKind::UnexpectedEof,
                "Async half was dropped.",
            ))
        } else {
            Ok(())
        }
    }
}

impl Read for AsyncAdapterStream {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        loop {
            let block = !(self.bytes_known_present.load(Ordering::Relaxed)
                || self.finalised.load(Ordering::Relaxed));
            drop(self.handle_messages(Operation::Read { block }));

            let mut rb = self.bytes_out.lock();
            match rb.read(buf) {
                Ok(n) => {
                    self.notify_tx.notify_one();
                    return Ok(n);
                },
                Err(e) if e.kind() == IoErrorKind::WouldBlock => {
                    // receive side must ABSOLUTELY be unblocked here.
                    self.notify_tx.notify_one();
                    if self.finalised.load(Ordering::Relaxed) {
                        return Ok(0);
                    }
                    self.bytes_known_present.store(false, Ordering::Relaxed);
                    self.check_dropped()?;
                },
                a => {
                    println!("Misc err {a:?}");
                    return a;
                },
            }
        }
    }
}

impl Seek for AsyncAdapterStream {
    fn seek(&mut self, pos: SeekFrom) -> IoResult<u64> {
        if !self.can_seek {
            return Err(IoError::new(
                IoErrorKind::Unsupported,
                "Async half does not support seek operations.",
            ));
        }

        self.check_dropped()?;

        _ = self.req_tx.send(AdapterRequest::Seek(pos));

        // wait for async to tell us that it has stopped writing,
        // then clear buf and allow async to write again.
        self.finalised.store(false, Ordering::Relaxed);
        match self.handle_messages(Operation::Seek) {
            Some(AdapterResponse::SeekClear) => {},
            None => self.check_dropped().map(|()| unreachable!())?,
            _ => unreachable!(),
        }

        let mut rb = self.bytes_out.lock();
        let cap = rb.capacity();
        rb.skip(cap.into());

        _ = self.req_tx.send(AdapterRequest::SeekCleared);

        match self.handle_messages(Operation::Seek) {
            Some(AdapterResponse::SeekResult(a)) => a,
            None => self.check_dropped().map(|()| unreachable!()),
            _ => unreachable!(),
        }
    }
}

impl MediaSource for AsyncAdapterStream {
    fn is_seekable(&self) -> bool {
        self.can_seek
    }

    fn byte_len(&self) -> Option<u64> {
        self.check_dropped().ok()?;

        _ = self.req_tx.send(AdapterRequest::ByteLen);

        match self.handle_messages(Operation::Len) {
            Some(AdapterResponse::ByteLen(a)) => a,
            None => self.check_dropped().ok().map(|()| unreachable!()),
            _ => unreachable!(),
        }
    }
}

enum AdapterRequest {
    Wake,
    Seek(SeekFrom),
    SeekCleared,
    ByteLen,
}

enum AdapterResponse {
    SeekResult(IoResult<u64>),
    SeekClear,
    ByteLen(Option<u64>),
    ReadZero,
    ReadOccurred,
}

#[derive(Copy, Clone)]
enum Operation {
    Read { block: bool },
    Seek,
    Len,
}

impl Operation {
    fn will_block(self) -> bool {
        match self {
            Self::Read { block } => block,
            _ => true,
        }
    }

    fn expected_msg(self, msg: &AdapterResponse) -> bool {
        match self {
            Self::Read { .. } => matches!(
                msg,
                AdapterResponse::ReadOccurred | AdapterResponse::ReadZero
            ),
            Self::Seek => matches!(
                msg,
                AdapterResponse::SeekResult(_) | AdapterResponse::SeekClear
            ),
            Self::Len => matches!(msg, AdapterResponse::ByteLen(_)),
        }
    }
}

/// An async port of symphonia's [`MediaSource`].
///
/// Streams which are not seekable should implement `AsyncSeek` such that all operations
/// fail with `Unsupported`, and implement `fn is_seekable(&self) -> { false }`.
///
/// [`MediaSource`]: MediaSource
#[async_trait]
pub trait AsyncMediaSource: AsyncRead + AsyncSeek + Send + Sync + Unpin {
    /// Returns if the source is seekable. This may be an expensive operation.
    fn is_seekable(&self) -> bool;

    /// Returns the length in bytes, if available. This may be an expensive operation.
    async fn byte_len(&self) -> Option<u64>;

    /// Tries to recreate this stream in event of an error, resuming from the given offset.
    async fn try_resume(
        &mut self,
        _offset: u64,
    ) -> Result<Box<dyn AsyncMediaSource>, AudioStreamError> {
        Err(AudioStreamError::Unsupported)
    }
}
