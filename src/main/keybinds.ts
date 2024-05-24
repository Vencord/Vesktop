/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import net from "net";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMP || "/tmp";
const socketFile = path.join(xdgRuntimeDir, "vesktop-ipc");

export function initKeybinds() {
    child_process.spawnSync("mkfifo", [socketFile]);
    fs.open(socketFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK, (err, fd) => {
        if (err) {
            console.error("Error opening pipe:", err);
            return;
        }

        const pipe = new net.Socket({ fd });
        pipe.on("data", data => {
            const Actions = new Set([IpcEvents.TOGGLE_SELF_DEAF, IpcEvents.TOGGLE_SELF_MUTE]);
            const action = data.toString().trim();
            if (Actions.has(action as IpcEvents)) {
                mainWin.webContents.send(action);
            }
        });

        pipe.on("end", () => {
            pipe.destroy();
            initKeybinds();
        });
    });
}
