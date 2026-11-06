/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { waitFor } from "@vencord/types/webpack";
import { ACTION_MAP, ShortcutAction } from "shared/utils/keybind";

const logger = new Logger("VesktopKeyBindHandler");

interface KeyBindAction {
    onTrigger(...args: any[]): void;
    isPressed?: boolean;
    keyEvents: { keydown: boolean; keyup: boolean };
}

let KeyBindActions: Record<string, KeyBindAction>;

waitFor(["dispatch", "subscribe"], fd => {
    fd.subscribe("KEYBINDS_REGISTER_GLOBAL_KEYBIND_ACTIONS", (event: any) => {
        KeyBindActions = event.keybinds;
    });
});

export function handleKeyBind(action: ShortcutAction, keyup: boolean) {
    if (action === "unassigned") return;

    if (!KeyBindActions) {
        logger.error("KeyBindActions not yet available");
        return;
    }

    const discordKey = ACTION_MAP[action];
    if (!discordKey) {
        logger.warn(`Unknown action: ${action}`);
        return;
    }

    const kb = KeyBindActions[discordKey];
    if (!kb) {
        logger.warn(`Discord KeyBindAction not found: ${discordKey}`);
        return;
    }

    // Discord's own sloplogic handles this
    if (!keyup && kb.keyEvents.keydown) kb.onTrigger(true, "default");
    if (keyup && kb.keyEvents.keyup) kb.onTrigger(false, "default");
}
