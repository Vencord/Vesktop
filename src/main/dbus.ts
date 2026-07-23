/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { EventEmitter } from "events";
import { XDPShortcut } from "libvesktop";
import { join } from "path";
import { STATIC_DIR } from "shared/paths";

let libVesktop: typeof import("libvesktop") | null = null;

function loadLibVesktop() {
    try {
        if (!libVesktop) {
            libVesktop = require(join(STATIC_DIR, `dist/libvesktop-${process.arch}.node`));
        }
    } catch (e) {
        console.error("Failed to load libvesktop:", e);
    }

    return libVesktop;
}

export function updateUnityLauncherCount(count: number) {
    const libVesktop = loadLibVesktop();
    if (!libVesktop) {
        return app.setBadgeCount(count);
    }

    return libVesktop.updateUnityLauncherCount(count);
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibVesktop()?.requestBackground(autoStart, commandLine) ?? false;
}

export const xdpEmitter = new EventEmitter();
let xdpShortcuts: InstanceType<typeof import("libvesktop").XDPGlobalShortcuts> | null = null;

export function initXDPGlobalShortcuts(): Promise<string> {
    return new Promise((resolve, reject) => {
        const libVesktop = loadLibVesktop();
        if (!libVesktop) {
            reject();
            return;
        }
        xdpShortcuts = new libVesktop.XDPGlobalShortcuts(xdpEmitter);

        xdpEmitter.once("ready", (sessionHandle: string) => resolve(sessionHandle));
        xdpEmitter.once("fatal", (err: any) => reject(new Error(`XDP fatal: ${err}`)));
    });
}

export function bindXDPShortcuts(shortcuts: XDPShortcut[]) {
    xdpShortcuts?.bindShortcuts(shortcuts);
}

export function configureXDPShortcuts() {
    xdpShortcuts?.configureShortcuts();
}

export function onXDPShortcutEvent(event: string, callback: (id: string, pressed: boolean, timestamp: number) => void) {
    xdpEmitter.on(event, callback);
}

export function destroyXDPShortcuts() {
    xdpShortcuts?.destroy();
    xdpShortcuts = null;
    xdpEmitter.removeAllListeners();
}
