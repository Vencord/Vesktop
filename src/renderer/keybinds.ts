/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { State } from "./settings";

export const actionReadableNames: { [key: string]: string } = {
    PUSH_TO_TALK: "Push To Talk",
    PUSH_TO_TALK_PRIORITY: "Push To Talk (Priority)",
    PUSH_TO_MUTE: "Push To Mute",
    TOGGLE_MUTE: "Toggle Mute",
    TOGGLE_DEAFEN: "Toggle Deafen",
    TOGGLE_VOICE_MODE: "Toggle Voice Activity Mode",
    TOGGLE_STREAMER_MODE: "Toggle Streamer Mode",
    TOGGLE_CAMERA: "Toggle Camera",
    NAVIGATE_BACK: "Navigate Back",
    NAVIGATE_FORWARD: "Navigate Forward",
    DISCONNECT_FROM_VOICE_CHANNEL: "Disconnect From Voice Channel"
};

export const actionCallbacks: {
    [action: string]: {
        onTrigger: Function;
        keyEvents: {
            keyup: boolean;
            keydown: boolean;
        };
    };
} = {};

export async function triggerKeybind(action: string, keyup: boolean) {
    var cb = actionCallbacks[action];
    if (cb.keyEvents.keyup && keyup) {
        cb.onTrigger(false);
    } else if (cb.keyEvents.keydown && !keyup) {
        cb.onTrigger(true);
    }
}

export async function registerKeybinds() {
    if (VesktopNative.keybind.needsXdp()) return;
    VesktopNative.keybind.setKeybinds(
        State.store.keybinds?.map(x => ({
            id: x.action,
            shortcut: x.shortcut
        })) || []
    );
}

export async function unregisterKeybinds() {
    if (VesktopNative.keybind.needsXdp()) return;
    VesktopNative.keybind.setKeybinds([]);
}

registerKeybinds();
