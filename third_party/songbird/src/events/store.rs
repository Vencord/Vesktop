use super::*;
use crate::{
    constants::*,
    tracks::{ReadyState, TrackHandle, TrackState},
};
use enum_map::EnumMap;
use std::collections::{BinaryHeap, HashMap};
use tracing::info;

#[derive(Debug, Default)]
/// Storage for [`EventData`], designed to be used for both local and global contexts.
///
/// Timed events are stored in a binary heap for fast selection, and have custom `Eq`,
/// `Ord`, etc. implementations to support (only) this.
///
/// [`EventData`]: EventData
pub struct EventStore {
    timed: BinaryHeap<EventData>,
    untimed: Box<EnumMap<UntimedEvent, Vec<EventData>>>,
    local_only: bool,
}

impl EventStore {
    /// Creates a new event store to be used globally.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a new event store to be used within a [`Track`].
    ///
    /// This is usually automatically installed by the driver once
    /// a track has been registered.
    ///
    /// [`Track`]: crate::tracks::Track
    #[must_use]
    pub fn new_local() -> Self {
        EventStore {
            local_only: true,
            ..Default::default()
        }
    }

    /// Add an event to this store.
    ///
    /// Updates `evt` according to [`EventData::compute_activation`].
    ///
    /// [`EventData::compute_activation`]: EventData::compute_activation
    pub fn add_event(&mut self, mut evt: EventData, now: Duration) {
        evt.compute_activation(now);

        if self.local_only && evt.event.is_global_only() {
            return;
        }

        match evt.event {
            Event::Core(c) => {
                self.untimed[c.into()].push(evt);
            },
            Event::Track(t) => {
                self.untimed[t.into()].push(evt);
            },
            Event::Delayed(_) | Event::Periodic(_, _) => {
                self.timed.push(evt);
            },
            _ => {
                // Event cancelled.
            },
        }
    }

    /// Processes all events due up to and including `now`.
    pub(crate) async fn process_timed(&mut self, now: Duration, ctx: EventContext<'_>) {
        while let Some(evt) = self.timed.peek() {
            if evt
                .fire_time
                .as_ref()
                .expect("Timed event must have a fire_time.")
                > &now
            {
                break;
            }
            let mut evt = self
                .timed
                .pop()
                .expect("Can only succeed due to peek = Some(...).");

            let old_evt_type = evt.event;
            if let Some(new_evt_type) = evt.action.act(&ctx).await {
                evt.event = new_evt_type;
                self.add_event(evt, now);
            } else if let Event::Periodic(d, _) = old_evt_type {
                evt.event = Event::Periodic(d, None);
                self.add_event(evt, now);
            }
        }
    }

    /// Processes all events due up to and including `now`.
    pub(crate) fn timed_event_ready(&self, now: Duration) -> bool {
        self.timed.peek().is_some_and(|evt| {
            evt.fire_time
                .as_ref()
                .expect("Timed event must have a fire_time.")
                <= &now
        })
    }

    /// Processes all events attached to the given track event.
    pub(crate) async fn process_untimed(
        &mut self,
        now: Duration,
        untimed_event: UntimedEvent,
        ctx: EventContext<'_>,
    ) {
        // move a Vec in and out: not too expensive, but could be better.
        // Although it's obvious that moving an event out of one vec and into
        // another necessitates that they be different event types, thus entries,
        // convincing the compiler of this is non-trivial without making them dedicated
        // fields.
        let mut events = std::mem::take(&mut self.untimed[untimed_event]);
        if !events.is_empty() {
            // TODO: Possibly use tombstones to prevent realloc/memcpys?
            // i.e., never shrink array, replace ended tracks with <DEAD>,
            // maintain a "first-track" stack and freelist alongside.
            let mut i = 0;
            while i < events.len() {
                let evt = &mut events[i];
                // Only remove/readd if the event type changes (i.e., Some AND new != old)
                if let Some(new_evt_type) = evt.action.act(&ctx).await {
                    if evt.event == new_evt_type {
                        let mut evt = events.remove(i);

                        evt.event = new_evt_type;
                        self.add_event(evt, now);
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                };
            }
            self.untimed[untimed_event] = events;
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct GlobalEvents {
    pub(crate) store: EventStore,
    pub(crate) time: Duration,
    pub(crate) awaiting_tick: HashMap<TrackEvent, Vec<usize>>,
}

impl GlobalEvents {
    pub(crate) fn add_event(&mut self, evt: EventData) {
        self.store.add_event(evt, self.time);
    }

    pub(crate) async fn fire_core_event(&mut self, evt: CoreEvent, ctx: EventContext<'_>) {
        self.store.process_untimed(self.time, evt.into(), ctx).await;
    }

    pub(crate) fn fire_track_event(&mut self, evt: TrackEvent, index: usize) {
        let holder = self.awaiting_tick.entry(evt).or_default();

        holder.push(index);
    }

    pub(crate) fn remove_handlers(&mut self) {
        self.store = EventStore::new();
    }

    pub(crate) async fn tick(
        &mut self,
        events: &mut [EventStore],
        states: &mut [TrackState],
        handles: &mut [TrackHandle],
    ) {
        // Global timed events
        self.time += TIMESTEP_LENGTH;
        if self.store.timed_event_ready(self.time) {
            let global_ctx: Vec<(&TrackState, &TrackHandle)> =
                states.iter().zip(handles.iter()).collect();
            self.store
                .process_timed(self.time, EventContext::Track(&global_ctx[..]))
                .await;
        }

        // Local timed events
        for (i, state) in states.iter_mut().enumerate() {
            if state.playing.is_playing() && state.ready == ReadyState::Playable {
                state.step_frame();

                let event_store = events
                    .get_mut(i)
                    .expect("Missing store index for Tick (local timed).");
                let handle = handles
                    .get_mut(i)
                    .expect("Missing handle index for Tick (local timed).");

                event_store
                    .process_timed(state.play_time, EventContext::Track(&[(state, handle)]))
                    .await;
            }
        }

        for (evt, indices) in &self.awaiting_tick {
            let untimed = (*evt).into();

            if !indices.is_empty() {
                info!("Firing {:?} for {:?}", evt, indices);
            }

            // Local untimed track events.
            for &i in indices {
                let event_store = events
                    .get_mut(i)
                    .expect("Missing store index for Tick (local untimed).");
                let handle = handles
                    .get_mut(i)
                    .expect("Missing handle index for Tick (local untimed).");
                let state = states
                    .get_mut(i)
                    .expect("Missing state index for Tick (local untimed).");

                event_store
                    .process_untimed(
                        state.position,
                        untimed,
                        EventContext::Track(&[(state, handle)]),
                    )
                    .await;
            }

            // Global untimed track events.
            if !self.store.untimed[untimed].is_empty() && !indices.is_empty() {
                let global_ctx: Vec<(&TrackState, &TrackHandle)> = indices
                    .iter()
                    .map(|i| {
                        (
                            states
                                .get(*i)
                                .expect("Missing state index for Tick (global untimed)"),
                            handles
                                .get(*i)
                                .expect("Missing handle index for Tick (global untimed)"),
                        )
                    })
                    .collect();

                self.store
                    .process_untimed(self.time, untimed, EventContext::Track(&global_ctx[..]))
                    .await;
            }
        }

        // Now drain vecs.
        for indices in self.awaiting_tick.values_mut() {
            indices.clear();
        }
    }
}
