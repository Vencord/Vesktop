/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { findByPropsLazy } from "@vencord/types/webpack";
import { FluxDispatcher, StreamerModeStore } from "@vencord/types/webpack/common";

import { ShortcutAction } from "./ShortcutSettings";

const logger = new Logger("VesktopKeyBindHandler");

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel");

export function handleKeyBind(keyBind: ShortcutAction) {
    logger.debug(`Handling key bind action: ${keyBind}`);

    switch (keyBind) {
        case "toggleMute":
            FluxDispatcher.dispatch({
                type: "AUDIO_TOGGLE_SELF_MUTE",
                context: "default",
                syncRemote: true,
                playSoundEffect: true
            });
            break;

        case "toggleDeafen":
            FluxDispatcher.dispatch({
                type: "AUDIO_TOGGLE_SELF_DEAF",
                context: "default",
                syncRemote: true
            });
            break;

        case "toggleStreamerMode":
            FluxDispatcher.dispatch({
                type: "STREAMER_MODE_UPDATE",
                key: "enabled",
                value: !StreamerModeStore.enabled
            });
            break;

        case "disconnectFromVoiceChannel":
            selectVoiceChannel(null);
            break;

        case "unassigned":
            break;

        default:
            logger.warn(`Unknown key bind action: ${keyBind}`);
    }
}
