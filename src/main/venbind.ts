/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import type { Venbind as VenbindType } from "venbind";

import { mainWin } from "./mainWindow";
import { handle, handleSync } from "./utils/ipcWrappers";

let venbind: VenbindType | null = null;
export function obtainVenbind() {
    if (venbind == null) {
        // TODO?: make binary outputs consistant with node's apis
        let os: string;
        let arch: string;

        switch (process.platform) {
            case "linux":
                os = "linux";
                break;
            case "win32":
                os = "windows";
                break;
            // case "darwin":
            //     os = "darwin";
            //     break;
            default:
                return null;
        }
        switch (process.arch) {
            case "x64":
                arch = "x86_64";
                break;
            // case "arm64":
            //     arch = "aarch64";
            //     break;
            default:
                return null;
        }

        venbind = require(join(STATIC_DIR, `dist/venbind-${os}-${arch}.node`));
    }
    return venbind;
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
    if (
        process.platform === "linux" &&
        (process.env.XDG_SESSION_TYPE === "wayland" ||
            !!process.env.WAYLAND_DISPLAY ||
            !!process.env.VENBIND_USE_XDG_PORTAL)
    ) {
        return true;
    }
    return false;
});
handle(IpcEvents.KEYBIND_SET_KEYBINDS, (_, keybinds: { id: string; name?: string; shortcut?: string }[]) => {
    venbind?.setKeybinds(keybinds);
});
