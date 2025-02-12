/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { constants, existsSync, open, unlinkSync } from "node:fs";
import { join } from "node:path";

import { Socket } from "net";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMP || "/tmp";
const socketFile = join(xdgRuntimeDir, "vesktop-ipc");

const Actions = new Set([IpcEvents.TOGGLE_SELF_DEAF, IpcEvents.TOGGLE_SELF_MUTE]);

function createFIFO() {
    if (existsSync(socketFile)) {
        try {
            unlinkSync(socketFile);
        } catch (err) {
            console.error("Failed to remove existing mkfifo file:", err);
            return false;
        }
    }

    try {
        spawnSync("mkfifo", [socketFile]);
    } catch (err) {
        console.error("Failed to create mkfifo while initializing keybinds:", err);
        return false;
    }
    return true;
}

function openFIFO() {
    try {
        open(socketFile, constants.O_RDONLY | constants.O_NONBLOCK, (err, fd) => {
            if (err) {
                console.error("Error opening pipe while initializing keybinds:", err);
                return;
            }

            const pipe = new Socket({ fd });
            pipe.on("data", data => {
                const action = data.toString().trim();
                if (Actions.has(action as IpcEvents)) {
                    mainWin.webContents.send(action);
                }
            });

            pipe.on("end", () => {
                pipe.destroy();
                openFIFO();
            });
        });
    } catch (err) {
        console.error("Can't open socket file.", err);
    }
}

function cleanup() {
    try {
        unlinkSync(socketFile);
    } catch (err) {}
}

process.on("exit", cleanup);

export function initKeybinds() {
    if (createFIFO()) {
        openFIFO();
    }
}
