/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync } from "fs";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import type { Venbind as VenbindType } from "venbind";

import { mainWin } from "./mainWindow";
import { handle, handleSync } from "./utils/ipcWrappers";

let venbind: VenbindType | null = null;
export function obtainVenbind() {
    var path = join(STATIC_DIR, `dist/venbind-${process.platform}-${process.arch}.node`);
    if (existsSync(path)) venbind = require(path);
}

export function startVenbind() {
    obtainVenbind();
    venbind?.defineErrorHandle((err: string) => {
        console.error("venbind error:", err);
        venbind = null;
    });
    venbind?.startKeybinds((id, keyup) => {
        mainWin.webContents.executeJavaScript(`Vesktop.triggerKeybind("${id}", ${keyup})`);
    }, null);
}

handleSync(IpcEvents.KEYBIND_NEEDS_XDP, _ => {
    return (
        process.platform === "linux" &&
        (process.env.XDG_SESSION_TYPE === "wayland" ||
            !!process.env.WAYLAND_DISPLAY ||
            !!process.env.VENBIND_USE_XDG_PORTAL)
    );
});
handle(IpcEvents.KEYBIND_SET_KEYBINDS, (_, keybinds: { id: string; name?: string; shortcut?: string }[]) => {
    venbind?.setKeybinds(keybinds);
});
handleSync(IpcEvents.KEYBIND_GET_CURRENT_SHORTCUT, _ => {
    return venbind?.getCurrentShortcut();
});
