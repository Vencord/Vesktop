/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy, findStoreLazy } from "@vencord/types/webpack";
import { FluxDispatcher } from "@vencord/types/webpack/common";

import { IpcCommands } from "../../shared/IpcEvents";
import { onIpcCommand } from "../ipcCommands";
import { addPatch } from "./shared";

// Allows app zoom to function in Vesktop

const AccessibilityStore = findStoreLazy("AccessibilityStore");
const ScalingConstants = findByPropsLazy("ZOOM_SCALES");

addPatch({
    patches: [
        {
            // Re-enable the zoom slider in appearance settings
            find: ".Component{renderZoomSlider(){",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /(renderZoomSlider\(\)\{.+?return) \i\.isPlatformEmbedded/,
                    replace: "$1 true"
                }
            ]
        },
        {
            // Redirect DiscordNative calls for setZoomFactor to VesktopNative
            find: '"discord_erlpack","discord_game_utils","discord_rpc","discord_spellcheck","discord_utils","discord_voice"',
            replacement: {
                // eslint-disable-next-line no-useless-escape
                match: /setZoomFactor:(\i)=>/,
                replace: "$& VesktopNative.win.setZoomFactor($1 / 100) &&"
            }
        }
    ]
});

onIpcCommand(IpcCommands.ZOOM_IN, () => {
    FluxDispatcher.dispatch({
        type: "ACCESSIBILITY_SET_ZOOM",
        zoom: getNextZoomScale(1)
    });
});

onIpcCommand(IpcCommands.ZOOM_OUT, () => {
    FluxDispatcher.dispatch({
        type: "ACCESSIBILITY_SET_ZOOM",
        zoom: getNextZoomScale(-1)
    });
});

onIpcCommand(IpcCommands.ZOOM_RESET, () => {
    FluxDispatcher.dispatch({ type: "ACCESSIBILITY_RESET_TO_DEFAULT" });
});

function getNextZoomScale(next: number): number {
    const scales = ScalingConstants.ZOOM_SCALES as number[];
    const zoom = AccessibilityStore.zoom as number;

    return scales[Math.max(0, Math.min(scales.indexOf(zoom) + next, scales.length - 1))];
}
