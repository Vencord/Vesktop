/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const muteActions = findByPropsLazy("isSelfMute");
const deafActions = findByPropsLazy("isSelfDeaf");

function setCurrentState() {
    if (deafActions.isSelfDeaf()) {
        VesktopNative.app.setTrayIcon("deafened");
    } else if (muteActions.isSelfMute()) {
        VesktopNative.app.setTrayIcon("muted");
    } else {
        VesktopNative.app.setTrayIcon("idle");
    }
}

onceReady.then(() => {
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID) {
            if (params.speakingFlags) {
                VesktopNative.app.setTrayIcon("speaking");
            } else {
                setCurrentState();
            }
        }
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", () => {
        setCurrentState();
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", () => {
        setCurrentState();
    });

    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", params => {
        if (params.state === "RTC_CONNECTED") {
            setCurrentState();
        } else if (params.state === "RTC_DISCONNECTED") {
            VesktopNative.app.setTrayIcon("main");
        }
    });
});
