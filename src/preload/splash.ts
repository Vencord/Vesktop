/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron/renderer";

contextBridge.exposeInMainWorld("VesktopSplashNative", {
    onUpdateMessage(callback: (message: string) => void) {
        ipcRenderer.on("update-splash-message", (_, message: string) => callback(message));
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);
    const root = document.documentElement;

    const fg = params.get("fg");
    const bg = params.get("bg");

    if (fg) {
        root.style.setProperty("--fg", fg);
        root.style.setProperty("--fg-semi-trans", `color-mix(in srgb, ${fg} 20%, transparent)`);
    }
    if (bg) root.style.setProperty("--bg", bg);
    if (params.has("pixelated")) root.classList.add("pixelated");
});
