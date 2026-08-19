/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { waitFor } from "@vencord/types/webpack";
import { FluxDispatcher } from "@vencord/types/webpack/common";

import { ShortcutAction } from "./ShortcutSettings";

const logger = new Logger("VesktopKeyBindHandler");

interface KeyBindAction {
    onTrigger(...args: any[]): void;
    isPressed?: boolean;
}

let KeyBindActions: Record<string, KeyBindAction>;

waitFor(["dispatch", "subscribe"], FluxDispatcher => {
    FluxDispatcher.subscribe("KEYBINDS_REGISTER_GLOBAL_KEYBIND_ACTIONS", event => {
        KeyBindActions = event.keybinds;
    });
});

export function handleKeyBind(keyBind: ShortcutAction) {
    logger.debug(`Handling key bind action: ${keyBind}`);

    if (!KeyBindActions) {
        logger.error("Failed to retrieve KeyBindActions, cannot handle key bind");
        return;
    }

    switch (keyBind) {
        case "unassigned":
            break;

        case "mute":
        case "unmute":
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_SELF_MUTE",
                context: "default",
                syncRemote: true,
                playSoundEffect: true,
                mute: keyBind === "mute"
            });
            break;
        case "toggleMute":
            KeyBindActions.TOGGLE_MUTE.onTrigger();
            break;

        case "toggleDeafen":
            KeyBindActions.TOGGLE_DEAFEN.onTrigger();
            break;

        case "toggleStreamerMode":
            KeyBindActions.TOGGLE_STREAMER_MODE.onTrigger();
            break;

        case "disconnectFromVoiceChannel":
            KeyBindActions.DISCONNECT_FROM_VOICE_CHANNEL.onTrigger();
            break;

        case "pushToTalkNormalStart":
        case "pushToTalkNormalStop":
        case "pushToTalkNormalToggle": {
            const isPressed = keyBind.includes("Toggle")
                ? !KeyBindActions.PUSH_TO_TALK.isPressed
                : keyBind.includes("Start");

            KeyBindActions.PUSH_TO_TALK.onTrigger(isPressed, "default");
            break;
        }
        case "pushToTalkPriorityStart":
        case "pushToTalkPriorityStop":
        case "pushToTalkPriorityToggle": {
            const isPressed = keyBind.includes("Toggle")
                ? !KeyBindActions.PUSH_TO_TALK_PRIORITY.isPressed
                : keyBind.includes("Start");

            KeyBindActions.PUSH_TO_TALK_PRIORITY.onTrigger(isPressed, "default");
            break;
        }
        default:
            logger.warn(`Unknown key bind action: ${keyBind}`);
    }
}
