use nonmax::NonMaxU32;
use std::time::Duration;

/// A type similar to [`std::time::Duration`] except using an `f32`.
///
/// This limits precision, only allowing by-second precision up to ~194 days,
/// but in turn shinks type size from `16` bytes to `4` bytes.
///
/// # Implementation Note
///
/// We actually store this as `NonMaxU32`, in order to get a niche to make `Option<FloatDuration>` the same size.
#[derive(Clone, Copy)]
pub struct FloatDuration(NonMaxU32);

impl FloatDuration {
    /// Creates a [`FloatDuration`] from a raw `f32` value.
    ///
    /// # Panics
    /// This may panic if `value` is a NaN value.
    #[must_use]
    pub fn from_secs_f32(value: f32) -> Self {
        Self(NonMaxU32::new(value.to_bits()).expect("value should not be NaN"))
    }

    /// Converts a [`FloatDuration`] to an `f32`.
    ///
    /// This is cheaper than converting to a [`Duration`] and using [`Duration::as_secs_f32`] as it is more direct.
    #[must_use]
    pub fn as_secs_f32(self) -> f32 {
        f32::from_bits(self.0.get())
    }
}

impl std::fmt::Debug for FloatDuration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("FloatDuration")
            .field(&Duration::from(*self))
            .finish()
    }
}

impl PartialEq for FloatDuration {
    fn eq(&self, other: &Self) -> bool {
        self.as_secs_f32() == other.as_secs_f32()
    }
}

impl PartialOrd for FloatDuration {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.as_secs_f32().partial_cmp(&other.as_secs_f32())
    }
}

impl From<Duration> for FloatDuration {
    fn from(value: Duration) -> Self {
        Self::from_secs_f32(value.as_secs_f32())
    }
}

impl From<FloatDuration> for Duration {
    fn from(value: FloatDuration) -> Self {
        Duration::from_secs_f32(value.as_secs_f32())
    }
}
