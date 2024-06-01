/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { spawnSync } from "node:child_process";
import { constants, open } from "node:fs";
import { join } from "node:path";

import { Socket } from "net";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMP || "/tmp";
const socketFile = join(xdgRuntimeDir, "vesktop-ipc");

export function initKeybinds() {
    spawnSync("mkfifo", [socketFile]);
    open(socketFile, constants.O_RDONLY | constants.O_NONBLOCK, (err, fd) => {
        if (err) {
            console.error("Error opening pipe:", err);
            return;
        }

        const pipe = new Socket({ fd });
        pipe.on("data", data => {
            const Actions = new Set([IpcEvents.TOGGLE_SELF_DEAF, IpcEvents.TOGGLE_SELF_MUTE]);
            const action = data.toString().trim();
            if (Actions.has(action as IpcEvents)) {
                mainWin.webContents.send(action);
            }
        });

        pipe.once("end", () => {
            pipe.destroy();
            initKeybinds();
        });
    });
}
