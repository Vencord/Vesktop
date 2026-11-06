/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, systemPreferences } from "electron";
import { IpcEvents } from "shared/IpcEvents";

import { IS_WAYLAND, SOCKET_PATH } from "../constants";
import { Settings } from "../settings";
import { handle, handleSync } from "../utils/ipcWrappers";
import { setStatus, status } from "./actions";
import { setHookBinds, stopHook } from "./hook";
import { configurePortalShortcuts, setPortalEnabled, stopPortal } from "./portal";

export { runShortcutCommand } from "./actions";

// Wayland doesn't let apps see global input, not even XWayland ones, so we have to go through the portal there
function update() {
    if (IS_WAYLAND) setPortalEnabled(!!Settings.store.globalShortcutsPortal);
    else setStatus(setHookBinds(Settings.store.keyBinds ?? []));
}

export function initKeybinds() {
    update();

    if (IS_WAYLAND) Settings.addChangeListener("globalShortcutsPortal", update);
    else Settings.addChangeListener("keyBinds", update);
}

handle(IpcEvents.KEYBINDS_GET_STATUS, () => status);
handleSync(IpcEvents.KEYBINDS_GET_SOCKET_PATH, () => SOCKET_PATH);
handle(IpcEvents.KEYBINDS_RETRY, update);
handle(IpcEvents.KEYBINDS_REQUEST_PERMISSION, () => {
    if (process.platform === "darwin") systemPreferences.isTrustedAccessibilityClient(true);
});
handle(IpcEvents.KEYBINDS_CONFIGURE_PORTAL, configurePortalShortcuts);

app.on("will-quit", () => {
    stopHook();
    stopPortal();
});
