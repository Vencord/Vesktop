# Port: Electron/TypeScript → Rust/egui

This branch (`rust-port`) replaces the Electron app with a fully native
Rust client, following the same pattern as
[crmne/spotifast](https://github.com/crmne/spotifast) and
[crmne/zapfast](https://github.com/crmne/zapfast): **eframe/egui** for the
whole UI (through the [crmne/egui](https://github.com/crmne/egui) fork,
wired with `[patch.crates-io]`), tokio for the network, no browser engine.
The Electron implementation remains on the `main` branch and in git
history.

## Module map

| Rust module | Ported from (Electron app) | Notes |
|---|---|---|
| `src/main.rs`, `src/app.rs` | `src/main/main.ts`, window management | one `eframe::App`, panels instead of BrowserWindows |
| `src/backend/api.rs` | Discord's internal REST calls through the web app | direct API v10 calls (`reqwest`, rustls) |
| `src/backend/gateway.rs` | web app's internal gateway socket | native WebSocket (`tokio-tungstenite`), heartbeat, reconnect + backoff |
| `src/backend/events.rs` | `src/preload/typedIpc.ts`, `ipc.ts` | typed channels replace Electron IPC |
| `src/model.rs` | (implicit in the web app's data) | serde models for the used subset |
| `src/ui/*` | `src/renderer/*`, custom titlebar, settings components | login, server rail, channel sidebar, chat, settings window |
| `src/markup.rs` | Discord web's message renderer | mini tokenizer: bold/italic/code/mentions/emoji/links |
| `src/image_cache.rs` | (web app image loading) | avatars/guild icons fetched off-thread into egui textures |
| `src/settings.rs`, `src/paths.rs` | `src/shared/settings.ts`, `settingsStore` | JSON settings in the user config dir |
| `src/theme.rs` | custom CSS theming | Discord palette applied via `egui::Visuals` |
| `src/window.rs`, `src/tray.rs` | `src/main/tray.ts`, window icon, splash | ICO window icon; tray behind `--features tray` |
| `src/util.rs` | `src/shared/utils` | snowflake math, timestamps, CDN URLs |
| `assets/*` | `build/icon.*`, `static/tray/*` | same artwork carried over |

## Vesktop settings, native equivalents

`tray`, `minimizeToTray` and `checkForUpdates` are stored (and surfaced in
the settings window); the first two only take effect once the tray lands.
`discordBranch`, Vencord, splash and hardware-acceleration toggles have no
meaning without a browser engine and were dropped. `zoom` maps to egui's
`pixels_per_point`; `theme` to dark/light visuals.

## Not ported yet (roadmap)

- **Voice & screenshare** — the largest gap; planned on songbird following
  the Acheron model, see [VOICE.md](VOICE.md).
- **Vencord plugins** — a native plugin story needs design; the Electron
  plugin runtime cannot be reused.
- **Gateway RESUME** — reconnects currently re-IDENTIFY.
- **Keyring token storage** — the spotifast pattern (`keyring-core`);
  the token currently sits in `settings.json`.
- **Clickable links, image previews, reactions, threads, pins, nitro
  emojis** — chat rendering is text-first right now.
- **arRPC** (Rich Presence bridge), **autostart**, **app badge**,
  **spellcheck**, **auto-update** (`fastframe-update` once the pattern's
  framework crates are adopted).
- **Adopting `fastframe-*` crates** — tray, fonts, i18n, scroll, updates:
  the natural next step to converge fully with the spotifast/zapfast
  pattern once their APIs are stable.

## Why login is token-based

Discord's interactive login is a web page (captcha included); a browser
engine was exactly what this port removes. The token flow mirrors what
Vesktop's renderer does internally after login: hold the token, speak
REST + Gateway. See the README for how to extract it.
