/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

let libVesktop: typeof import("libvesktop") | null = null;

function loadLibVesktop() {
    if (!libVesktop) {
        libVesktop = require(require("libvesktop"));
    }
    return libVesktop!;
}

export function getAccentColor() {
    return loadLibVesktop().getAccentColor();
}

export function updateUnityLauncherCount(count: number) {
    return loadLibVesktop().updateUnityLauncherCount(count);
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibVesktop().requestBackground(autoStart, commandLine);
}
