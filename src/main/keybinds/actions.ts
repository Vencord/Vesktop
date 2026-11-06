/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcCommands } from "shared/IpcEvents";
import { KeybindStatus, ShortcutAction } from "shared/utils/keybind";

import { IS_WAYLAND } from "../constants";
import { AppEvents } from "../events";
import { sendRendererCommand } from "../ipcCommands";

let appLoaded = false;
AppEvents.on("appLoaded", () => (appLoaded = true));

export let status: KeybindStatus = { backend: IS_WAYLAND ? "portal" : "hook" };

export function setStatus(newStatus: Omit<KeybindStatus, "backend">) {
    status = { backend: status.backend, ...newStatus };

    if (appLoaded)
        sendRendererCommand(IpcCommands.KEYBINDS_STATUS, status).catch(err =>
            console.error("Failed to send keybind status:", err)
        );
}

// Events before Discord is loaded are dropped rather than queued, as they would all fire at once later
export function triggerAction(action: ShortcutAction, pressed: boolean) {
    if (!appLoaded) return;

    sendRendererCommand(IpcCommands.KEYBINDS_TRIGGER, { action, pressed }).catch(err =>
        console.error("Failed to trigger keybind action:", action, err)
    );
}

/** Runs a command parsed by parseShortcutCommand. If pressed is undefined, the action is pressed and released */
export function runShortcutCommand({ action, pressed }: { action: ShortcutAction; pressed?: boolean }) {
    if (pressed !== undefined) return triggerAction(action, pressed);

    triggerAction(action, true);
    triggerAction(action, false);
}
