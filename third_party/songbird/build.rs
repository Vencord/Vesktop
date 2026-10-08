#[cfg(all(feature = "driver", not(any(feature = "rustls", feature = "native"))))]
compile_error!(
    "You have the `driver` feature enabled: \
    either the `rustls` or `native` feature must be
    selected to let Songbird's driver use websockets.\n\
    - `rustls` uses Rustls, a pure Rust TLS-implemenation.\n\
    - `native` uses SChannel on Windows, Secure Transport on macOS, \
    and OpenSSL on other platforms.\n\
    If you are unsure, go with `rustls`."
);

#[cfg(any(
    all(feature = "driver", feature = "tws", feature = "tungstenite"),
    all(feature = "driver", not(feature = "tws"), not(feature = "tungstenite"))
))]
compile_error!(
    "You have the `driver` feature enabled: \
    this requires you specify either: \n\
    - `tungstenite` (recommended with serenity)\n\
    - or `tws` (recommended with twilight).\n\
    You have either specified none, or both - choose exactly one."
);

fn main() {}
