use super::*;
use std::cmp::Ordering;

/// Internal representation of an event, as handled by the audio context.
pub struct EventData {
    pub(crate) event: Event,
    pub(crate) fire_time: Option<Duration>,
    pub(crate) action: Box<dyn EventHandler>,
}

impl EventData {
    /// Create a representation of an event and its associated handler.
    ///
    /// An event handler, `action`, receives an [`EventContext`] and optionally
    /// produces a new [`Event`] type for itself. Returning `None` will
    /// maintain the same event type, while removing any [`Delayed`] entries.
    /// Event handlers will be re-added with their new trigger condition,
    /// or removed if [`Cancel`]led
    ///
    /// [`EventContext`]: EventContext
    /// [`Event`]: Event
    /// [`Delayed`]: Event::Delayed
    /// [`Cancel`]: Event::Cancel
    pub fn new<F: EventHandler + 'static>(event: Event, action: F) -> Self {
        Self {
            event,
            fire_time: None,
            action: Box::new(action),
        }
    }

    /// Computes the next firing time for a timer event.
    pub fn compute_activation(&mut self, now: Duration) {
        match self.event {
            Event::Periodic(period, phase) => {
                self.fire_time = Some(now + phase.unwrap_or(period));
            },
            Event::Delayed(offset) => {
                self.fire_time = Some(now + offset);
            },
            _ => {},
        }
    }
}

impl std::fmt::Debug for EventData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> Result<(), std::fmt::Error> {
        write!(
            f,
            "Event {{ event: {:?}, fire_time: {:?}, action: <fn> }}",
            self.event, self.fire_time
        )
    }
}

/// Events are ordered/compared based on their firing time.
impl Ord for EventData {
    fn cmp(&self, other: &Self) -> Ordering {
        // FIXME: we don't have let chains in this edition songbird uses so when we upgrade to 2024 edition,
        //   change this to a let chain that way it reads easier
        if let Some(t1) = &self.fire_time {
            if let Some(t2) = &other.fire_time {
                return t2.cmp(t1);
            }
        }
        Ordering::Equal
    }
}

impl PartialOrd for EventData {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for EventData {
    fn eq(&self, other: &Self) -> bool {
        self.fire_time == other.fire_time
    }
}

impl Eq for EventData {}
