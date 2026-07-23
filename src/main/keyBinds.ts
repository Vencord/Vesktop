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
    if (!app.isReady()) return;
    globalShortcut.unregisterAll();
}

export async function registerKeyBinds() {
    await app.whenReady();

    unregisterKeyBinds();

    let success = true;

    for (const { action, enabled, key } of Settings.store.keyBinds || []) {
        if (!enabled || !key || action === "unassigned") continue;

        const registeredSuccessfully = globalShortcut.register(key, () =>
            sendRendererCommand(IpcCommands.KEY_BINDS_HANDLE, action)
        );
        success &&= registeredSuccessfully;
    }

    sendRendererCommand(IpcCommands.KEY_BINDS_SET_STATUS, success);
}

Settings.addChangeListener("keyBinds", registerKeyBinds);

app.on("will-quit", unregisterKeyBinds);
