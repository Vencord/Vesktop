/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import type { XDPGlobalShortcutsEvent } from "libvesktop";
import { STATIC_DIR } from "shared/paths";

import { IS_FLATPAK } from "./constants";

// Name of our .desktop file, which portals and GNOME identify us by
const APP_ID = process.env.FLATPAK_ID ?? "vesktop";

let libVesktop: typeof import("libvesktop") | null = null;

function loadLibVesktop() {
    try {
        if (!libVesktop) {
            libVesktop = require(
                join(STATIC_DIR, `dist/libvesktop-${process.arch}.node`)
            ) as typeof import("libvesktop");
            if (!IS_FLATPAK) libVesktop.registerHostApp(APP_ID);
        }
    } catch (e) {
        console.error("Failed to load libvesktop:", e);
    }

    return libVesktop;
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibVesktop()?.requestBackground(autoStart, commandLine) ?? false;
}

export function isStatusNotifierHostRegistered() {
    return loadLibVesktop()?.isStatusNotifierHostRegistered() ?? true;
}

export function createXDPGlobalShortcuts(onEvent: (...args: XDPGlobalShortcutsEvent) => void) {
    const lib = loadLibVesktop();
    if (!lib) return null;

    return new lib.XDPGlobalShortcuts(onEvent);
}

export function openGnomeAppSettings() {
    return loadLibVesktop()?.openGnomeAppSettings(APP_ID) ?? false;
}
