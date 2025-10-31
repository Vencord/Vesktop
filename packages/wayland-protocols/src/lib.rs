mod dispatch_impls;

use anyhow::{anyhow, Error};
use napi::{bindgen_prelude::Function, threadsafe_function::ThreadsafeFunction, Status};
use napi_derive::napi;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
};
use wayland_client::{
    globals::{registry_queue_init},
    protocol::wl_seat::WlSeat,
    Connection, Proxy,
};
use wayland_protocols::ext::idle_notify::v1::client::ext_idle_notifier_v1::ExtIdleNotifierV1;

pub type UnitInfalliableCallback = ThreadsafeFunction<(), (), (), Status, false>;

struct IdleNotifierState {
    is_idle: Arc<AtomicBool>,
    on_idled: Option<UnitInfalliableCallback>,
    on_resumed: Option<UnitInfalliableCallback>,
}

#[napi(object)]
pub struct IdleNotifierOptions<'cb> {
    pub timeout_ms: u32,
    pub on_idled: Option<Function<'cb, (), ()>>,
    pub on_resumed: Option<Function<'cb, (), ()>>,
}

#[napi]
pub struct IdleNotifier {
    is_idle: Arc<AtomicBool>,
}

#[napi]
impl IdleNotifier {
    #[napi(constructor)]
    pub fn new(opts: IdleNotifierOptions) -> Result<Self, Error> {
        let is_idle = Arc::new(AtomicBool::new(false));
        let mut state = IdleNotifierState {
            is_idle: is_idle.clone(),
            on_idled: opts
                .on_idled
                .map(|cb| cb.build_threadsafe_function().build())
                .transpose()?,
            on_resumed: opts
                .on_resumed
                .map(|cb| cb.build_threadsafe_function().build())
                .transpose()?,
        };

        let connection = Connection::connect_to_env()?;
        let (globals, mut event_queue) = registry_queue_init(&connection)?;
        let globals_list = globals.contents().clone_list();

        if globals_list
            .iter()
            .all(|g| g.interface != ExtIdleNotifierV1::interface().name)
        {
            return Err(anyhow!(
                "ext_idle_notifier_v1 is not supported by the compositor",
            ));
        }

        let queue_handle = event_queue.handle();

        let interface_ver = globals_list
            .iter()
            .find(|g| g.interface == WlSeat::interface().name)
            .ok_or_else(|| anyhow!("no wl_seat found in global list"))?
            .version;
        let seat = globals.bind(&queue_handle, interface_ver..=interface_ver, ())?;

        globals
            .bind::<ExtIdleNotifierV1, IdleNotifierState, ()>(&queue_handle, 1..=1, ())?
            .get_idle_notification(opts.timeout_ms, &seat, &queue_handle, ());

        thread::spawn(move || loop {
            if let Err(err) = event_queue.blocking_dispatch(&mut state) {
                eprintln!("wayland dispatch error: {err}");
            };
        });

        Ok(Self { is_idle })
    }

    #[napi]
    pub fn is_idle(&self) -> bool {
        self.is_idle.load(Ordering::SeqCst)
    }
}
