/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { rmSync } from "fs";
import { createServer, Server } from "net";
import { createInterface } from "readline";

import { app } from "electron";
import { IpcCommands } from "shared/IpcEvents";
import { parseShortcutCommand } from "shared/utils/keybind";
import { VoiceState } from "shared/voiceState";

import { SOCKET_PATH } from "./constants";
import { sendRendererCommand } from "./ipcCommands";
import { runShortcutCommand } from "./keybinds";

let server: Server | undefined;

const RENDERER_TIMEOUT_MS = 3000;

async function runCommand(line: string): Promise<string> {
    const [command, arg = ""] = line.trim().split(/\s+/, 2);

    switch (command) {
        case "run-shortcut": {
            const shortcut = parseShortcutCommand(arg);
            if (!shortcut) return "error: invalid shortcut";

            runShortcutCommand(shortcut);
            return "ok";
        }
        case "get-voice-state": {
            try {
                const state = await sendRendererCommand<VoiceState>(
                    IpcCommands.GET_VOICE_STATE,
                    undefined,
                    RENDERER_TIMEOUT_MS
                );
                return JSON.stringify(state);
            } catch (err) {
                return `error: ${String(err)}`;
            }
        }
        case "set-voice-state": {
            const match = /^mute=(true|false)$/.exec(arg);
            if (!match) return "error: usage: set-voice-state mute=<true|false>";

            try {
                await sendRendererCommand(
                    IpcCommands.SET_VOICE_STATE,
                    { mute: match[1] === "true" },
                    RENDERER_TIMEOUT_MS
                );
                return "ok";
            } catch (err) {
                return `error: ${String(err)}`;
            }
        }
        default:
            return "error: unknown command";
    }
}

/**
 * Line based socket for triggering actions from other programs, for example compositor keybinds.
 * Connections stay open, so a client can send multiple commands, like `run-shortcut pushToTalk:down` and `:up`.
 * Every line gets a reply line, either "ok" or "error: <reason>", except where noted:
 *
 * - `get-voice-state` replies with a JSON object, `{"mute":boolean,"deaf":boolean}`
 * - `set-voice-state mute=<true|false>` sets self mute to an absolute value
 */
export function initSocket() {
    // We hold the single instance lock, so any existing socket is stale
    if (process.platform !== "win32") rmSync(SOCKET_PATH, { force: true });

    server = createServer({ allowHalfOpen: true }, socket => {
        socket.on("error", () => {});

        let queue = Promise.resolve();

        const lines = createInterface({ input: socket });

        lines.on("error", () => {});
        lines.on("line", line => {
            if (!line.trim()) return;

            queue = queue
                .then(async () => {
                    const response = await runCommand(line);
                    if (!socket.destroyed && socket.writable) socket.write(response + "\n");
                })
                .catch(err => {
                    if (!socket.destroyed && socket.writable) socket.write(`error: ${String(err)}\n`);
                });
        });

        socket.on("end", () => void queue.then(() => socket.end()));
    });

    server.on("error", err => console.error("Failed to start IPC socket:", err));
    server.listen(SOCKET_PATH);
}

app.on("will-quit", () => {
    if (!server) return;

    server.close();
    if (process.platform !== "win32") rmSync(SOCKET_PATH, { force: true });
});
