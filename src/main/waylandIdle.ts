/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import { Millis } from "shared/utils/millis";

import { isWayland } from "./constants";
import { VencordSettings } from "./settings";
import { handleSync } from "./utils/ipcWrappers";

let isWaylandIdle: () => boolean;

export function initWaylandIdleHandler() {
    handleSync(IpcEvents.IS_WAYLAND_IDLE, () => {
        isWaylandIdle ??= initWaylandIdleWatcher();
        return isWaylandIdle();
    });
}

function initWaylandIdleWatcher(): () => boolean {
    if (!isWayland || VencordSettings.store.plugins?.CustomIdle?.idleTimeout === 0) return () => false;

    try {
        const waylandProtocols = require(
            join(STATIC_DIR, `dist/wayland-protocols-${process.arch}.node`)
        ) as typeof import("wayland-protocols");

        const idleNotifier = new waylandProtocols.IdleNotifier({
            timeoutMs: (VencordSettings.store.plugins?.CustomIdle?.idleTimeout ?? 10) * Millis.MINUTE
        });

        return () => idleNotifier.isIdle();
    } catch (e) {
        console.error("failed to load wayland idle notifier: ", e);
        return () => false;
    }
}
