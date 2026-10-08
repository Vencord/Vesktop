/// An unread byte stream for an audio file.
pub struct AudioStream<T: Send> {
    /// The wrapped file stream.
    ///
    /// An input stream *must not* have been read into past the start of the
    /// audio container's header.
    pub input: T,
}
