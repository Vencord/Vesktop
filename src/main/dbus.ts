/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

let libVesktop: typeof import("libvesktop") | null = null;

function loadLibvesktop() {
    if (!libVesktop) {
        libVesktop = require(require("libvesktop"));
    }
    return libVesktop!;
}

export function getAccentColor() {
    return loadLibvesktop().getAccentColor();
}

export function setUnityLauncherEntry(count: number) {
    return loadLibvesktop()!.updateUnityLauncherEntry(count);
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibvesktop()!.requestBackground(autoStart, commandLine);
}
