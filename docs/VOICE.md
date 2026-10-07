# Voice plan: the Acheron model on songbird

Electron Vesktop has no voice code of its own: it loads `discord.com/app`
(`src/main/mainWindow.ts`) and Discord's web JS does voice over WebRTC.
Browser-free clients have to speak the voice protocol themselves. Among
open-source clients, [Acheron](https://github.com/ouwou/acheron) (C++/Qt6)
is the one with working voice since DAVE became mandatory (March 2026).
Abaddon has no DAVE and lost voice, and Dorion (Rust/Tauri on WebKitGTK)
has no voice on Linux. This port follows Acheron's model:

| Acheron | This port |
|---|---|
| voice WS + UDP + libsodium + libdave | [songbird](https://github.com/serenity-rs/songbird) 0.6 `Driver` (DAVE via `davey`) |
| miniaudio | `cpal` (mic + speakers) |
| rnnoise | `nnnoiseless` (phase 4) |

## Phase 0 — foundation

- Add `songbird` with `driver, gateway, receive, rustls, tungstenite`.
  `gateway` is only there because `receive` fails to build without it in
  0.6.0 (`dashmap` is gated behind `gateway`). Add `cpal`.
- CI (`.github/workflows/rust.yml`) installs `libopus-dev` and
  `libasound2-dev`; the opus `bundled` feature is available for packaging.
- Done when: it builds locally and in CI.

## Phase 1 — join/leave and channel presence

- `src/backend/gateway.rs`: `Command::JoinVoice { guild_id, channel_id }` /
  `LeaveVoice` send **op 4** over the live socket. `dispatch` handles
  `VOICE_STATE_UPDATE` (who's in each channel, our `session_id`) and
  `VOICE_SERVER_UPDATE` (`endpoint` + `token`).
- New `src/backend/voice.rs`: once both events arrive, build a
  `ConnectionInfo` and call `Driver::connect`; songbird handles the voice
  WS, UDP and DAVE. Connect/drop events become `UiEvent`s.
- `src/app.rs`: per-guild `voice_states` (seeded from READY, updated by
  events) and a `VoiceConn` state (connecting/connected/error).
- UI: voice channels become clickable (`src/ui/channel_sidebar.rs`, which
  today only shows a "not supported" tooltip), members listed under each
  channel, and a "Voz conectada · #canal" panel with a disconnect button
  at the bottom of the sidebar, like Discord's.
- Done when: joining from this client shows you in the channel on the
  phone app and the DAVE handshake completes.

## Phase 2 — listening

- `DecodeMode::Decode`: each 20 ms `VoiceTick` carries per-user PCM; mix it
  and play through `cpal` via a ring buffer.
- SSRC → user mapping from `SpeakingStateUpdate` drives a speaking
  indicator.
- Deafen button (also `self_deaf` in op 4).
- Done when: someone talking on the phone is heard and lights up.

## Phase 3 — talking

- `cpal` mic capture → ring buffer → a custom `MediaSource` that yields
  silence when empty (never blocks the mixer) → `RawAdapter` (f32,
  48 kHz) → `driver.play_input`.
- Mute button (stops feeding the mic, `self_mute` in op 4).
- Main risk: songbird is built for bots and buffers its inputs. Measure
  the added latency; if it's above ~150 ms, encode Opus ourselves and use
  songbird's Opus passthrough.
- Done when: the phone hears you with acceptable delay.

## Phase 4 — polish

- Input/output device picker in the settings window (`cpal` enumerates).
- Per-user volume and input sensitivity (voice activity).
- Noise suppression with `nnnoiseless` (Acheron uses rnnoise).
- Switching channels directly; auto-rejoin when the driver drops.

## Later

- **DM calls**: songbird requires a guild id, and DMs need ringing.
  Unverified.
- **Screenshare + venmic**: the voice-adjacent part Electron Vesktop does
  implement itself (`src/main/venmic.ts`, `src/main/screenShare.ts`).

## Risks

- No known open-source client runs songbird on a user account. The voice
  protocol doesn't distinguish bots from users, but phase 1 is what
  confirms it.
- Third-party clients on user accounts are a Discord ToS risk, as for the
  rest of the port.
- Every phase ends with a manual test against a real channel with the
  phone app.
