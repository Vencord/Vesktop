# Screen share plan: Go Live over a native stream connection

Electron Vesktop only owns the picker (`src/main/screenShare.ts`,
`ScreenSharePicker.tsx`: one portal source on Wayland, resolution/fps,
venmic audio); Discord's web JS does the rest over WebRTC. Here the whole
stack is ours. Songbird can't carry video (fixed `Identify`, no `codecs`
in select-protocol, audio-only UDP), so the stream gets its own small
voice-WS + UDP client, following
[discord-native-voice](https://github.com/dolfies/discord-native-voice)
(Rust core, raw UDP, davey, Go Live both ways). Protocol facts come from
[Userdoccers](https://github.com/discord-userdoccers/discord-userdoccers)
(`topics/voice-connections.mdx`, "Stream Media Connections").

| Piece | Choice |
|---|---|
| capture | `ashpd` (ScreenCast portal) → `pipewire`, SHM BGRx frames (xdph falls back to SHM without DMA-BUF modifiers) |
| encode | `openh264` (built from source, BSD): Constrained Baseline, no B-frames, IDR every 1 s, `force_intra_frame()` on PLI |
| E2EE | `davey` (already a dep): `encrypt(MediaType::VIDEO, Codec::H264, frame)` |
| transport | own voice WS + UDP; AES-256-GCM rtpsize reusing songbird's `crypto.rs` |

## Phase 0 — foundation

- Add `ashpd` (`screencast`) and `pipewire`; `openh264` waits for
  phase 4, where it is first used.
- CI installs `libpipewire-0.3-dev` and `clang` (pipewire's bindgen).
- Done when: it builds locally and in CI.

## Phase 1 — capture

- New `src/backend/capture.rs`: portal session → pick screen/window →
  PipeWire stream of BGRx frames into a latest-frame slot.
- Local preview in the app (egui texture) to prove the frames.
- Done when: picking a screen shows it live inside FastDiscord.

## Phase 2 — gateway signaling

- `src/backend/gateway.rs`: op 18 CREATE_STREAM
  (`{type:"guild",guild_id,channel_id,preferred_region:null}`), op 22
  `{stream_key,paused:false}`, op 19 DELETE_STREAM. Stream key:
  `guild:<guild>:<channel>:<user>`.
- Dispatch STREAM_CREATE (`rtc_server_id`, `rtc_channel_id`),
  STREAM_SERVER_UPDATE (`endpoint`, `token`; null endpoint = server gone)
  and STREAM_DELETE (`reason`).
- `self_stream` on voice states → "AO VIVO" badge in the roster (the
  server sets it; we never send it).
- Done when: op 18 yields a STREAM_SERVER_UPDATE and the phone shows us
  as live (black stream is fine).

## Phase 3 — stream connection

- New `src/backend/stream.rs`, separate from the voice connection (which
  must stay up):
  - Identify with `server_id = rtc_server_id`, the voice `session_id`,
    the stream token, `video: true`,
    `streams: [{type:"screen", rid:"100", quality:100}]`, DAVE version.
  - Ready → our own `ssrc`/`rtx_ssrc` (never the voice ones), UDP IP
    discovery, Select Protocol with
    `codecs: [{name:"H264", type:"video", payload_type:105, rtx_payload_type:106, …}]`.
  - op 12 Video (required before any media) and op 5 speaking=2.
  - DAVE in its own MLS group: id `rtc_server_id - 1`. Same identity
    keypair as the voice connection, or clients show "unverified": patch
    songbird (`driver/connection/mod.rs:378` passes `key_pair: None`) to
    take a shared one.
- Done when: the handshake and the DAVE commit complete on the stream.

## Phase 4 — send video

- Frames → openh264 (720p30 default) → `davey.encrypt` on the whole
  Annex-B frame → RTP: Single-NAL + FU-A, 90 kHz, marker on the last
  packet, one-byte extensions (playout-delay id 6, content-type id 7 =
  screen).
- RTCP: Sender Report every ~5 s, NACK → RTX resend, PLI → keyframe.
- Done when: the phone watches us at 720p30 with under ~1 s of delay.

## Phase 5 — UI

- The "Compartilhar tela (em breve)" button in the voice action row
  opens a picker like Vesktop's: resolution (480/720/1080/source), fps
  (15/30/60), then the portal dialog.
- Live state: button turns into "Parar", badge on our roster row.

## Later

- **Watching** others' streams: op 20 WATCH_STREAM, depacketize (incl.
  STAP-A), decrypt, openh264 decode, egui texture; send PLI on start.
- Stream audio (venmic-style app audio).
- VAAPI encode (`ffmpeg-next`, `h264_vaapi`; this machine supports it) if
  openh264's CPU cost hurts.
- Preview thumbnail: `POST /streams/{stream_key}/preview`.

## Risks

- **Bans**: Discord-video-stream issue #224 (Aug 2026) reports accounts
  banned seconds after starting a stream, attributed to the JA3/JA4 TLS
  fingerprint; rustls doesn't look like a browser. Test on a throwaway
  account first.
- **UDP vs WebRTC**: Discord-video-stream moved to WebRTC (Dec 2025)
  saying "only WebRTC connections are allowed", yet discord-native-voice
  streams over raw UDP (Aug 2026). Phase 3 settles it; fallback is
  `str0m`.
- Header extension ids: Userdoccers/DNV say playout-delay is 6, older DVS
  used 5. Unverified which the server enforces.
- 720p30 without Nitro: unverified whether the server enforces it.
- Every phase ends with a manual test against a real channel with the
  phone app.
