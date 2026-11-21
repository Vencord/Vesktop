/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore } from "@vencord/types/webpack/common";
import type { VoiceState } from "shared/voiceState";

import { handleKeybind } from "./globalShortcuts/keybindHandler";

export function getVoiceState(): VoiceState {
    return {
        mute: MediaEngineStore.isSelfMute(),
        deaf: MediaEngineStore.isSelfDeaf()
    };
}

/** Sets self mute to an absolute value, unlike the toggleMute shortcut. */
export function setVoiceMute(mute: boolean): VoiceState {
    if (MediaEngineStore.isSelfMute() !== mute && !handleKeybind("toggleMute", false)) {
        throw new Error("Discord's toggle mute action is not available yet");
    }

    return getVoiceState();
}
