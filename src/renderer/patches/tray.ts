/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const voiceActions = findByPropsLazy("isSelfMute");

let isInCall = false;

export function setCurrentTrayIcon() {
    if (isInCall) {
        if (voiceActions.isSelfDeaf()) {
            VesktopNative.tray.setIcon("trayDeafened");
        } else if (voiceActions.isSelfMute()) {
            VesktopNative.tray.setIcon("trayMuted");
        } else {
            VesktopNative.tray.setIcon("trayIdle");
        }
    } else {
        VesktopNative.tray.setIcon("tray");
    }
}

onceReady.then(() => {
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID && params.context === "default") {
            if (params.speakingFlags) {
                VesktopNative.tray.setIcon("traySpeaking");
            } else {
                setCurrentTrayIcon();
            }
        }
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", () => {
        if (isInCall) setCurrentTrayIcon();
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", () => {
        if (isInCall) setCurrentTrayIcon();
    });

    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", params => {
        if (params.state === "RTC_CONNECTED" && params.context === "default") {
            isInCall = true;
            VesktopNative.tray.setIsInCall(true);
        } else if (params.state === "RTC_DISCONNECTED" && params.context === "default") {
            isInCall = false;
            VesktopNative.tray.setIsInCall(false);
        }
        setCurrentTrayIcon();
    });

    FluxDispatcher.subscribe("MESSAGE_NOTIFICATION_SHOWN", () => {
        setCurrentTrayIcon();
    });
});
