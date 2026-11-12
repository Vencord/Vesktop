/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { rmSync } from "fs";
import { createServer, Server } from "net";
import { createInterface } from "readline";

import { app } from "electron";
import { parseShortcutCommand } from "shared/utils/keybind";

import { SOCKET_PATH } from "./constants";
import { runShortcutCommand } from "./keybinds";

let server: Server | undefined;

function runCommand(line: string) {
    const [command, arg = ""] = line.trim().split(/\s+/, 2);

    switch (command) {
        case "run-shortcut": {
            const shortcut = parseShortcutCommand(arg);
            if (!shortcut) return "error: invalid shortcut";

            runShortcutCommand(shortcut);
            return "ok";
        }
        default:
            return "error: unknown command";
    }
}

/**
 * Line based socket for triggering actions from other programs, for example compositor keybinds.
 * Connections stay open, so a client can send multiple commands, like `run-shortcut pushToTalk:down` and `:up`.
 * Every line gets a reply line, either "ok" or "error: <reason>"
 */
export function initSocket() {
    // We hold the single instance lock, so any existing socket is stale
    if (process.platform !== "win32") rmSync(SOCKET_PATH, { force: true });

    server = createServer(socket => {
        socket.on("error", () => {});

        createInterface({ input: socket }).on("line", line => {
            if (line.trim()) socket.write(runCommand(line) + "\n");
        });
    });

    server.on("error", err => console.error("Failed to start IPC socket:", err));
    server.listen(SOCKET_PATH);
}

app.on("will-quit", () => {
    if (!server) return;

    server.close();
    if (process.platform !== "win32") rmSync(SOCKET_PATH, { force: true });
});
