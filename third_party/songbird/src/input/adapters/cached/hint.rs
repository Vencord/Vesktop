use std::time::Duration;
use streamcatcher::Config;

/// Expected amount of time that an input should last.
#[derive(Copy, Clone, Debug)]
pub enum LengthHint {
    /// Estimate of a source's length in bytes.
    Bytes(usize),
    /// Estimate of a source's length in time.
    ///
    /// This will be converted to a bytecount at setup.
    Time(Duration),
}

impl From<usize> for LengthHint {
    fn from(size: usize) -> Self {
        LengthHint::Bytes(size)
    }
}

impl From<Duration> for LengthHint {
    fn from(size: Duration) -> Self {
        LengthHint::Time(size)
    }
}

/// Modify the given cache configuration to initially allocate
/// enough bytes to store a length of audio at the given bitrate.
pub fn apply_length_hint<H>(config: &mut Config, hint: H, cost_per_sec: usize)
where
    H: Into<LengthHint>,
{
    config.length_hint = Some(match hint.into() {
        LengthHint::Bytes(a) => a,
        LengthHint::Time(t) => {
            let s = t.as_secs() + u64::from(t.subsec_millis() > 0);
            (s as usize) * cost_per_sec
        },
    });
}
