/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
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

export function getAccentColor() {
    return loadLibVesktop()?.getAccentColor() ?? null;
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
