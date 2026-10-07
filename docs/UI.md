# UI/UX plan: splash, QR login, server rail and chat timeline

The only UI Electron Vesktop draws itself is the **splash**
(`src/main/splash.ts`, `static/views/splash.html`): a 300×350 frameless
window with the animated `static/splash.webp` (128 px), "Loading
Vesktop..." and a status line (`updateSplashMessage`, e.g. "Failed to load
Discord: …"). Everything else (QR login, server rail, timeline) is
discord.com's UI, so Discord web is the reference there.

APIs checked against the pinned versions: `egui::Image::corner_radius`,
`ctx.animate_bool`, `egui_extras` animated WebP loader (`webp` feature),
`qrcode` `EcLevel::H`.

## 1. Startup splash

Today, with a saved token the app opens on the login screen showing
"Conectando…" next to the token field.

- Dedicated splash state: saved token and no `READY` yet → splash, not
  login.
- Vesktop's look: restore `static/splash.webp` from git history and animate
  it via `egui_extras` (`webp` + `image` features), "Carregando Vesktop…"
  under it, plus a status line.
- Status follows the real steps: "Conectando ao Discord…", "Carregando
  servidores…", "Reconectando em 5s…"; on error, **Tentar de novo** and
  **Sair da conta** buttons.
- Lives inside the main window rather than a separate one: Vesktop's splash
  window covers Electron's slow startup, egui opens instantly.

## 2. QR login

Follow Discord's layout:

- Two-column card: left, "Boas-vindas de volta!" and token login collapsed
  as an advanced option; right, the QR with "Entrar com código QR" and
  "Escaneie com o app do Discord no celular". Stacks on narrow windows.
- Vesktop icon in the middle of the QR; switch to `EcLevel::H` so it still
  scans.
- After scanning: avatar and name from `pending_ticket` (it carries id and
  avatar hash), "Confirme no seu celular" and a "Começar de novo" link.
- On expiry: regenerate silently, as Discord does. The retry button is
  only for real failures.

## 3. Server rail

- **Scrolling:** Home (DMs) button and a separator pinned on top, guilds in
  a `ScrollArea` with a hidden scrollbar.
- **Order:** Discord's own. `/users/@me/guilds` ignores the user's order;
  the real one is `user_settings.guild_folders` in `READY`. Folders render
  as in Discord (2×2 mini icons in the folder color, expand on click).
  Needs validating: user-account `READY` may only carry it as protobuf
  (`user_settings_proto`).
- **Rounded icons** (`src/ui/server_rail.rs` draws them square today):
  - Circle via `Image::corner_radius(24)`, animating to a rounded square
    (radius 16) on hover/selection with `animate_bool`.
  - Discord's left pill: 8 px dot for unread, 20 px bar on hover, 40 px
    when selected.
  - Mentions as a red badge with the count.
- **Drag to reorder:** later; persisting order means writing Discord's
  settings proto.

## 4. DM chat timeline, Discord-style

Today every message repeats a square avatar, name and time.

- **Date separators:** a horizontal rule with "6 de outubro de 2026" in the
  middle (`util::day_label` already exists, unused).
- **Grouping:** consecutive messages from the same author, under 7 minutes
  apart and not replies, render compact (no avatar or name); hovering
  shows the time in the left gutter.
- **Header times:** "Hoje às 14:32", "Ontem às 09:10" or the full date,
  exact time in the tooltip.
- **New messages:** red "NOVAS" divider at the first unread, and a "Ir para
  o presente" button when scrolled up.
- **Conversation start:** once there's no more history, large avatar, name
  and "Este é o começo do seu histórico de mensagens diretas com @fulano",
  replacing the "Carregar mensagens anteriores" button.
- **Replies:** curved connector with a mini avatar and an excerpt of the
  original above the message; `model.rs` reads `message_reference` and
  `referenced_message`.
- **Round avatars** everywhere; hover highlights the whole message row.
- **DM sidebar:** ordered by most recent conversation (`last_message_id`,
  not read by `model.rs` yet), round avatar and a status dot.
- **"Fulano está digitando…"** under the compose box from `TYPING_START`;
  send ours via `POST /typing`.
- **Compose box:** Enter sends, Shift+Enter adds a newline (single-line
  today); rounded, Discord's background.

## 5. General

- **User panel** at the bottom of the channel sidebar replacing the status
  bar: avatar, name, status, mic/headset/settings buttons. It's the same
  panel voice phase 1 needs ([VOICE.md](VOICE.md)).
- **Inline image attachments** (the `ImageCache` exists), **clickable
  links** and **embeds** with their color bar (already on the
  [PORT.md](PORT.md) roadmap).
- **Visual consistency:** single spacing and corner-radius tokens in
  `theme.rs`, pointer cursor on everything clickable, consistent tooltips.
- **Shortcuts:** Alt+↑/↓ to switch channels, Esc closes settings, Ctrl+K
  quick switcher (last).

## Order

1. Server rail: rounded icons, scrolling, pill indicators. Quick and
   visible.
2. Chat timeline: separators, grouping, date headers. Biggest daily impact.
3. Splash and the new QR login.
4. Server order and folders (depends on validating `READY`).
5. Replies, typing indicator, multiline compose and the rest.
