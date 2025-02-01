/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findStoreLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher } from "@vencord/types/webpack/common";

const MediaEngineStore = findStoreLazy("MediaEngineStore");

function enableMediaEngine() {
    if (MediaEngineStore.isEnabled()) return;
    MediaEngineStore.getMediaEngine()
        .enable()
        .then(() => {
            FluxDispatcher.dispatch({
                type: "MEDIA_ENGINE_SET_AUDIO_ENABLED",
                enabled: true
            });
        });
}

VesktopNative.venbus.onToggleMute(() => {
    enableMediaEngine();
    FluxDispatcher.dispatch({
        type: "AUDIO_TOGGLE_SELF_MUTE"
    });
});

VesktopNative.venbus.onToggleDeafen(() => {
    enableMediaEngine();
    FluxDispatcher.dispatch({
        type: "AUDIO_TOGGLE_SELF_DEAF"
    });
});

function updateStates() {
    VesktopNative.venbus.updateMutedState(MediaEngineStore.isSelfMute());
    VesktopNative.venbus.updateDeafenedState(MediaEngineStore.isSelfDeaf());
}

onceReady.then(() => {
    updateStates();
    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", updateStates);
    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", updateStates);
});
