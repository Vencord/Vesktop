/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";

import { ShortcutAction } from "./ShortcutSettings";

const logger = new Logger("VesktopKeyBindHandler");

export function handleKeyBind(keyBind: ShortcutAction) {
    logger.debug(`Handling key bind action: ${keyBind}`);

    switch (keyBind) {
        case "toggleMute":
            break;
        case "toggleDeafen":
            break;
        case "toggleStreamerMode":
            break;
        case "toggleCamera":
            break;
        case "toggleScreenShare":
            break;
        case "disconnectFromVoiceChannel":
            break;
        case "unassigned":
            break;
        default:
            logger.warn(`Unknown key bind action: ${keyBind}`);
    }
}
