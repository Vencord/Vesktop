/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, powerMonitor } from "electron";
import { IpcEvents } from "shared/IpcEvents";
import { Millis } from "shared/utils/millis";

import { handle, handleSync } from "./utils/ipcWrappers";

let suspended = false;
let locked = false;

export function initNativeIdle(win: BrowserWindow) {
    powerMonitor.on("suspend", () => {
        suspended = true;
        win.webContents.send(IpcEvents.IDLE_POWER_EVENT);
    });

    powerMonitor.on("resume", () => {
        suspended = false;
        win.webContents.send(IpcEvents.NO_IDLE_POWER_EVENT);
    });

    // TODO
    // lock screen events are windows & mac exclusive
    // potentially use ext-session-lock for wayland? idk about xorg
    powerMonitor.on("lock-screen", () => {
        locked = true;
        win.webContents.send(IpcEvents.IDLE_POWER_EVENT);
    });

    powerMonitor.on("unlock-screen", () => {
        locked = false;
        win.webContents.send(IpcEvents.NO_IDLE_POWER_EVENT);
    });

    handleSync(IpcEvents.IS_SUSPENDED, () => suspended);
    handleSync(IpcEvents.IS_LOCKED, () => locked);
    // special case for wayland since chromium just isn't implementing ext-idle-notify
    // or some other universal equivalent to get how long the system has been idle for
    // see https://issues.chromium.org/issues/380125108
    handleSync(IpcEvents.IS_WAYLAND_IDLE, () => false); // TODO
    handle(IpcEvents.GET_IDLE_TIME_MS, () => powerMonitor.getSystemIdleTime() * Millis.SECOND);
}
