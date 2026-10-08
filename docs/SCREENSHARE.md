# Screen share

Electron Vesktop only owns the picker (`src/main/screenShare.ts`,
`ScreenSharePicker.tsx`: one portal source on Wayland, resolution/fps,
venmic audio); Discord's web JS does the rest over WebRTC. Here the whole
stack is ours, with two backends behind one button, picked in Settings →
"Compartilhamento de tela":

| Setting "Usar backend de compartilhamento do FockyTV" | Share | Watch |
|---|---|---|
| **on** (default) | WHIP publish to FockyTV | WHEP from FockyTV, in place of the chat |
| off | Discord Go Live (op 18 + own stream connection) | Discord Go Live (op 20) |

The FockyTV path works end to end. The Go Live path stays in the code for
later: it works up to the SFU receiving our video, which it does not yet
forward to viewers (see below).

| File | Role |
|---|---|
| `src/backend/capture.rs` | ScreenCast portal + PipeWire capture into a shared latest-frame slot |
| `src/backend/fockytv.rs` | WHIP publish, WHEP watch, `/api/status` polling (GStreamer) |
| `src/backend/stream.rs` | Go Live stream connection: handshake, DAVE, send and receive |
| `src/backend/encode.rs` | Go Live encoder thread (openh264) |
| `src/backend/rtp.rs` | rtpsize AES-GCM, H.264 (de)packetizer, RTCP (PLI, RR, SR) |
| `src/ui/screen_share.rs` | Sidebar preview ("AO VIVO") and the watch view |

## Capture (both backends)

- 🖥️ in the voice action row (only shown while in voice) opens the
  portal picker; the preview is a 16:9 box above "Voz conectada"; 🖥️ again
  stops. Every way a share ends goes through `stop_screen_share()`.
- PipeWire delivers SHM BGRx (xdg-desktop-portal-hyprland falls back to
  SHM when the consumer offers no DMA-BUF modifiers). The slot holds an
  `Arc<Frame>`; readers (preview, encoder, WHIP feeder) tell new frames
  apart by `seq`.

Pitfalls hit:

- **Capture paused ~8×/s.** xdph logged "Out of buffers" and renegotiated:
  the `process` callback converted each 2560×1080 frame while holding the
  buffer. It now only memcpys rows and hands the buffer back; conversion
  happens at the reader (the preview downscales to ≤ 640 px).
- **Picker never opened a second time.** ashpd caches its D-Bus connection
  in a `static`; a per-capture tokio runtime died with the first share and
  every later portal call hung. The portal now runs on the app's runtime,
  and sessions are closed explicitly (the cached connection would keep
  them, and their screencopy, alive).

## FockyTV backend

[FockyTV](https://github.com/FelipeMayerDev/fockytv) is MediaMTX (WHIP in,
WHEP out, relay only) behind a Go `server/live-api` that keeps the
broadcast-box API: `POST /api/whip`, `POST /api/whep?viewer=`,
`GET /api/status`. The stream key **is** the nickname, sent as
`Authorization: Bearer <key>`. Production: `https://tv.huestavo.com`
(VPS `/opt/fockytv`; deploys only on explicit request, per its
`AGENTS.md`).

### Sharing

Same pipeline as FockyTV's own Rust client (`client/src/pipeline/linux.rs`
in fockytv-share), minus its preview and audio branches:

```
appsrc (BGRx/RGBx, zero-copy from the capture slot)
 → videorate drop-only (60/30/15 fps) → videoconvert
 → vah264lpenc | vah264enc | x264enc | openh264enc   (first that encodes a probe)
 → h264parse → rtph264pay pt=96 config-interval=-1 mtu=1200
 → whipsink whip-endpoint=<server>/api/whip auth-token=<nick>
```

- Bitrate by source size (fockytv-share's `bitrate_for`): 12 Mbps up to
  ~1080p, 20 up to ~1440p, 32 above. GOP = 2 s.
- Stopping sets the pipeline to NULL, where whipsink DELETEs the WHIP
  session; the stream leaves `/api/status` in ~0.25 s. Leaving voice, a
  kick and Discord ending the call all stop the share; quitting
  (`on_exit`) and logging out also **wait** for the DELETE (≤ 3 s).
  Without it a killed process left the stream listed for ~32 s.

### Who's live

While in a call, `/api/status` is polled every 5 s. A voice member whose
Discord **username** matches a live key (case-insensitive) gets the
"AO VIVO" badge and becomes clickable. Our own nick defaults to our
username, so FastDiscord users match without setup.

### Watching

"Assistir" plays the live in the watch view (where the chat is):

```
whepsrc whep-endpoint=<server>/api/whep?viewer=<our nick> auth-token=<their key>
  video-caps = application/x-rtp, H264, packetization-mode=1,
               profile-level-id=42e01f, level-asymmetry-allowed=1
  audio-caps = EMPTY
 → queue → rtph264depay request-keyframe=true → h264parse
 → vah264dec | openh264dec → videoconvert → RGBA appsink (sync=false)
```

If the live ends or can't be opened, the view closes and the chat returns.

Pitfalls hit, in the order they showed up (MediaMTX's log on the VPS,
`docker logs fockytv-mtx`, was the key to each):

| Symptom | Cause | Fix |
|---|---|---|
| "codecs not supported by client" | whepsrc wants **RTP** caps; `video/x-h264` built no media at all | RTP caps with the browsers' H.264 fmtp (pion matches on packetization-mode + profile-level-id) |
| still "codecs not supported" | whepsrc bundles every m-line after the first with **port 0**, which MediaMTX reads as rejected; audio came first | offer video only (`audio-caps` empty) |
| connects, dies ~3 s in | `use-link-headers` made whepsrc offer twice | not set on the viewer |
| still dies, "not-linked" | with `decodebin3`'s dynamic output, the branch's ghost `sink` landed on `videoconvert`; the link failed (`Noformat`) | static chain with an explicit decoder, `queue` first |
| view frozen forever | `wait-for-keyframe` on a lossy link: a whole IDR never arrived intact | dropped; `request-keyframe` (PLI) stays |

### Glitches (packet loss)

Publishing through a VPN lost packets: MediaMTX logged "RTP packets lost"
and "invalid FU-A packet (non-starting)", one lost packet smearing the
picture until the next IDR — worst on fast screen switches, whose frames
are bursts of hundreds of packets.

- `mtu=1200`: rtph264pay's default 1400 plus SRTP/UDP/IP overflowed the
  tunnel (~1420). FockyTV's other clients never hit it (no VPN).
- NACK on every webrtcbin transceiver on both sides (`enable_nack`): the
  offer now carries `nack`, `nack pli` and `rtx`, which pion accepts.
- The viewer's depayloader sends a PLI on loss instead of waiting for the
  next scheduled IDR.

If glitches remain, the next lever is a lower bitrate: 20 Mbps for a
2560×1080 source is a lot through a VPN.

### Limitations

- **No audio**, either way: the publish has no audio branch, and the
  viewer can't offer audio without the port-0 problem above. Fix needs
  `whepclientsrc`/`whipclientsink` (newer gst-plugins-rs, not packaged
  here) or a video-first offer.
- Lives are matched by Discord username; someone on FockyTV's web UI under
  another nick shows on the server but not on the roster.

## Discord Go Live backend (setting off)

Songbird can't carry video (fixed `Identify`, no `codecs` in select
protocol, audio-only UDP), so the stream gets its own voice-WS + UDP
client, following
[discord-native-voice](https://github.com/dolfies/discord-native-voice)
(Rust, raw UDP, davey, Go Live both ways). Protocol facts from
[Userdoccers](https://github.com/discord-userdoccers/discord-userdoccers)
(`topics/voice-connections.mdx`, "Stream Media Connections").

### What works

- **Signaling** (main gateway): op 18 CREATE_STREAM + op 22 unpause, op 19
  DELETE_STREAM, op 20 WATCH_STREAM; STREAM_CREATE (`rtc_server_id`,
  `rtc_channel_id`), STREAM_SERVER_UPDATE, STREAM_DELETE. Stream key
  `guild:<guild>:<channel>:<user>`. `self_stream` on voice states drives the
  badge. A late `user_requested` STREAM_DELETE is our own op 19's echo and
  is ignored (the key repeats, so it used to kill a just-restarted share).
- **Stream connection**: identify with `server_id = rtc_server_id`, the
  voice `session_id`, `video: true`,
  `streams: [{type:"screen", rid:"100", quality:100}]`; IP discovery;
  select protocol with `codecs` (H264 105/106, opus 120), mode
  `aead_aes256_gcm_rtpsize`; op 12 before any media. **Raw UDP is
  accepted** (no WebRTC needed).
- **DAVE**: songbird's model and state machine, in the stream's own MLS
  group (`rtc_server_id - 1`). Two FastDiscord accounts reach a ready
  session as streamer and viewer.
- **Sending**: capture → openh264 (fit 1280×720, 30 fps, 2.5 Mbps, IDR
  every 2 s and on PLI / DAVE ready) → `davey.encrypt` on the Annex-B frame
  → single-NAL/FU-A packets ≤ 1200 bytes → sealed → UDP. The SFU's receiver
  reports confirm reception with no loss.
- **Viewer side**: op 12 `{video_ssrc: 0, streams: []}`, op 15 naming the
  streamer's ssrcs, RTP open → depacketize → `davey.decrypt` → openh264 on
  its own thread. Never exercised: no video has reached it.

### Open problem: the SFU doesn't forward

The viewer only ever receives RTCP. Tried, without effect on forwarding:

1. discord-native-voice's full one-byte extension set (toffset,
   abs-send-time, orientation, transport-cc, playout-delay, content-type,
   video-timing, stream type "screen", rid "100"). This *did* change the
   streamer side: the SFU started sending transport-cc feedback.
2. op 15 naming each ssrc (`{"<ssrc>": 100, "any": 100}`), as
   discord-native-voice's `request_video` does.
3. RTCP Sender Reports once a second (Discord-video-stream sends them).

Next leads:

- Bisect against the official client: a FastDiscord stream watched on the
  phone (is our sending accepted?), and an official stream watched in
  FastDiscord (does our viewer work?).
- Share the DAVE identity keypair with the voice connection (songbird
  passes `key_pair: None`, so each connection makes its own; clients may
  treat the stream as unverified).

### Risks

- **Bans**: Discord-video-stream issue #224 (Aug 2026) reports accounts
  banned seconds after starting a stream, attributed to the JA3/JA4 TLS
  fingerprint; rustls doesn't look like a browser. Use a throwaway account.
- 720p30 without Nitro: unverified whether the server enforces it.

## Testing

- **Two accounts on one machine**: settings live in `$XDG_CONFIG_HOME`, so
  a second instance with its own profile starts at the login screen:
  `XDG_CONFIG_HOME=/tmp/acct2/config XDG_DATA_HOME=/tmp/acct2/data
  ./target/debug/fastdiscord`.
- **Logs**: `RUST_LOG=info,fastdiscord::backend::fockytv=debug` (or
  `…::stream=debug` for Go Live; it logs per-5 s packet counters and
  decoded RTCP reports).
- **WHEP without the UI**: a throwaway `tests/*.rs` calling
  `fastdiscord::backend::fockytv::watch` against a live key with an
  `EventTx` on `egui::Context::default()` reproduces the viewer headless;
  `GST_DEBUG=3` shows the GStreamer side, `whepsrc:7` the SDP offer.
- **Server side**: `docker logs fockytv-mtx` (sessions, codec matching,
  loss) and `docker logs fockytv-api` (WHIP/WHEP requests) on the VPS.
