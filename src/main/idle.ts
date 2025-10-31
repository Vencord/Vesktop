/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, powerMonitor } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import { Millis } from "shared/utils/millis";

import { isWayland } from "./constants";
import { VencordSettings } from "./settings";
import { handle, handleSync } from "./utils/ipcWrappers";

let suspended = false;
let locked = false;

function getWaylandIdleCallback(win: BrowserWindow): () => boolean {
    if (!isWayland || VencordSettings.store.plugins?.CustomIdle?.idleTimeout === 0) return () => false;

    try {
        const waylandProtocols = require(
            join(STATIC_DIR, `dist/vesktop-wayland-protocols.linux-${process.arch}-gnu.node`)
        ) as typeof import("vesktop-wayland-protocols");

        const idleNotifier = new waylandProtocols.IdleNotifier({
            timeoutMs: (VencordSettings.store.plugins?.CustomIdle?.idleTimeout ?? 10) * Millis.MINUTE,
            onIdled: () => win.webContents.send(IpcEvents.IDLE_POWER_EVENT),
            onResumed: () => win.webContents.send(IpcEvents.NO_IDLE_POWER_EVENT)
        });

        return () => idleNotifier.isIdle();
    } catch (e) {
        console.error("failed to load wayland idle notifier: ", e);
        return () => false;
    }
}

export function initNativeIdle(win: BrowserWindow) {
    powerMonitor.on("suspend", () => {
        suspended = true;
        win.webContents.send(IpcEvents.IDLE_POWER_EVENT);
    });

    powerMonitor.on("resume", () => {
        suspended = false;
        win.webContents.send(IpcEvents.NO_IDLE_POWER_EVENT);
    });

    // lockscreen events are exclusive to macos and windows, wayland protocols do not
    // expose any way to query this information and idk about xorg
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
    handleSync(IpcEvents.IS_WAYLAND_IDLE, getWaylandIdleCallback(win));
    handle(IpcEvents.GET_IDLE_TIME_MS, () => powerMonitor.getSystemIdleTime() * Millis.SECOND);

    console.log(VencordSettings.store);
}
