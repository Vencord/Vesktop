/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { waitFor } from "@vencord/types/webpack";
import { ACTION_MAP, ShortcutAction } from "shared/utils/keybind";

const logger = new Logger("VesktopKeybinds");

interface KeybindAction {
    // keybind is the keybind from Discord's KeybindStore that triggered the action
    onTrigger(pressed: boolean, keybind: { action: string; shortcut: unknown[]; params: object }): void;
    keyEvents: { keydown: boolean; keyup: boolean };
}

let keybindActions: Record<string, KeybindAction> | undefined;

waitFor(["dispatch", "subscribe"], FluxDispatcher => {
    FluxDispatcher.subscribe("KEYBINDS_REGISTER_GLOBAL_KEYBIND_ACTIONS", (event: any) => {
        keybindActions = event.keybinds;
    });
});

export function handleKeybind(action: ShortcutAction, pressed: boolean) {
    if (!keybindActions) {
        logger.warn("Ignoring keybind, Discord has not registered its keybind actions yet");
        return;
    }

    const discordAction = ACTION_MAP[action];
    const keybind = keybindActions[discordAction];
    if (!keybind) {
        logger.warn(`Discord keybind action ${discordAction} not found`);
        return;
    }

    // Discord decides which key events an action uses. Push to talk uses both, toggles only key up
    if (pressed ? keybind.keyEvents.keydown : keybind.keyEvents.keyup)
        keybind.onTrigger(pressed, { action: discordAction, shortcut: [], params: {} });
}
