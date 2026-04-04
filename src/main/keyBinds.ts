/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, globalShortcut } from "electron";
import { IpcCommands } from "shared/IpcEvents";

import { sendRendererCommand } from "./ipcCommands";
import { Settings } from "./settings";

function unregisterKeyBinds() {
    globalShortcut.unregisterAll();
}

export async function registerKeyBinds() {
    await app.whenReady();

    unregisterKeyBinds();

    for (const { action, enabled, key } of Settings.store.keyBinds || []) {
        if (!enabled || !key || action === "unassigned") continue;

        console.log(
            key,
            "SUCCESS",
            globalShortcut.register(key, () => sendRendererCommand(IpcCommands.HANDLE_KEY_BIND, action))
        );
    }
}

Settings.addChangeListener("keyBinds", registerKeyBinds);

app.on("will-quit", unregisterKeyBinds);
