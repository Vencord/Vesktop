/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { rmSync } from "fs";
import { rm } from "fs/promises";
import { createServer, Server } from "net";
import { join } from "path";
import { IpcCommands } from "shared/IpcEvents";

import { sendRendererCommand } from "./ipcCommands";

const { env, platform } = process;

let server: Server;

const SOCKET_PATH =
    platform === "win32"
        ? "\\\\?\\pipe\\vesktop.sock"
        : join(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp", "vesktop.sock");

export async function initSocket() {
    await rm(SOCKET_PATH, { force: true });

    server = createServer(socket => {
        socket.setEncoding("utf-8");

        const reply = (message: string) => {
            socket.write(message);
            socket.end();
        };

        socket.on("data", async (data: string) => {
            try {
                const [command, ...args] = data.trim().split(":");

                if (command === "run-shortcut") {
                    await sendRendererCommand(IpcCommands.KEY_BINDS_HANDLE, { action: args[0], keyup: false });
                    return;
                }

                reply("Unknown Command");
            } catch (e) {
                reply("Unknown Error");
            }
        });
    });

    server.listen(SOCKET_PATH);
    server.on("error", err => console.error("Vesktop IPC Socket Error:", err));
}

app.on("will-quit", () => {
    server?.close();
    rmSync(SOCKET_PATH, { force: true });
});
