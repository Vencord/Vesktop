# FastDiscord

**FastDiscord é um cliente Discord nativo** — construído em **Rust + egui**, sem
nenhum browser engine. Este é o port do [Vesktop](https://github.com/Vencord/Vesktop)
(originalmente Electron/TypeScript) para o padrão dos apps nativos
[spotifast](https://github.com/crmne/spotifast) e
[zapfast](https://github.com/crmne/zapfast): a UI inteira é desenhada com
[egui](https://github.com/emilk/egui) (via o fork mantido
[crmne/egui](https://github.com/crmne/egui), ligado por `[patch.crates-io]`),
e o Discord é falado nativamente — REST + Gateway sobre tokio.

> Projeto não oficial, sem qualquer afiliação com o Discord. Clientes de
> terceiros podem violar os Termos de Serviço do Discord — use por sua conta
> e risco. Mantém a licença **GPL-3.0-or-later** do Vesktop original.

## Recursos

- **Nativo de verdade**: nada de Electron/Chromium — binário Rust com eframe/glow.
- Login da conta por **token** (a tela de login do Discord é uma página web com
  captcha; sem browser engine, o vínculo da conta é feito pelo token — igual a
  todo cliente nativo de terceiros).
- Lista de **servidores**, canais por categoria, **mensagens diretas**, chat com
  envio/recebimento ao vivo via **Gateway** (heartbeat, reconexão com backoff).
- Renderização de mensagens com **negrito, itálico, código, menções, canais,
  emojis custom e links** (subconjunto — ver roadmap).
- Avatares e ícones de servidor carregados em background.
- **Configurações persistentes** (tema claro/escuro, zoom, última conversa).
- Bandeja do sistema experimental: `cargo build --features tray`.

O que **ainda não** foi portado (voz/screenshare, Vencord, arRPC, RESUME,
keyring, etc.) está mapeado em [docs/PORT.md](docs/PORT.md), junto do mapa
módulo-a-módulo do port.

## Instalação

Ainda não há binários publicados — build from source (veja abaixo) ou CI
artifacts. Um `.desktop` de referência fica em
[packaging/vesktop.desktop](packaging/vesktop.desktop).

## Build from Source

Você precisa do Rust (o `rust-toolchain.toml` fixa a versão — o `rustup`
instala sozinho) e das libs gráficas do seu desktop; no Linux, os pacotes de
runtime usuais do X11/Wayland. Nenhum header de GTK/WebKit é necessário.

```sh
git clone https://github.com/FelipeMayerDev/FastDiscord
cd Vesktop

cargo run --release
# bandeja experimental:
cargo run --release --features tray
```

Dica: `cargo build --release` gera o binário em `target/release/vesktop`;
a primeira compilação resolve `Cargo.lock` automaticamente.

## Como obter o token

1. Abra `discord.com` no navegador e entre na sua conta;
2. Aperte `Ctrl+Shift+I` para abrir o DevTools;
3. Na aba **Console**, rode `localStorage.token`;
4. Copie o valor (entre aspas) e cole na tela de login do Vesktop.

Também é possível passar direto: `vesktop --token SEU_TOKEN`.

## Onde ficam as configurações

`settings.json` no diretório de configuração do usuário
(Linux: `~/.config/vesktop/`; macOS: `~/Library/Application Support/vesktop/`;
Windows: `%APPDATA%\vesktop\`). O token hoje vive nesse arquivo — movê-lo para
o keyring do sistema é item do roadmap.

## Roadmap

Ver [docs/PORT.md](docs/PORT.md). Próximos passos naturais: adotar os crates
`fastframe-*` (bandeja, fontes, i18n, updates), gateway RESUME, keyring para o
token e uma história de plugins nativa.

## Créditos e licença

- [Vesktop](https://github.com/Vencord/Vesktop) por Vendicated e contribuidores
  — o app original, GPL-3.0-or-later; este fork portou a ideia para Rust.
- [crmne](https://github.com/crmne) — padrão de app nativo Rust+egui
  (spotifast/zapfast/fastframe) e fork do egui usado aqui.
- [egui](https://github.com/emilk/egui) por Emil Ernerfeldt e contribuidores.

Licença: [GPL-3.0-or-later](LICENSE), herdada do Vesktop original.
