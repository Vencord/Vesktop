/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const muteActions = findByPropsLazy("isSelfMute");
const deafActions = findByPropsLazy("isSelfDeaf");

export var isInVC = false;

onceReady.then(() => {
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID) {
            if (params.speakingFlags) {
                VesktopNative.app.setTrayIcon("speaking");
            } else {
                if (deafActions.isSelfDeaf()) {
                    VesktopNative.app.setTrayIcon("deafened");
                } else if (muteActions.isSelfMute()) {
                    VesktopNative.app.setTrayIcon("muted");
                } else {
                    VesktopNative.app.setTrayIcon("idle");
                }
            }
        }
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", () => {
        if (deafActions.isSelfDeaf()) {
            VesktopNative.app.setTrayIcon("deafened");
        } else if (muteActions.isSelfMute()) {
            VesktopNative.app.setTrayIcon("muted");
        } else {
            VesktopNative.app.setTrayIcon("idle");
        }
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", () => {
        if (muteActions.isSelfMute()) {
            VesktopNative.app.setTrayIcon("muted");
        } else {
            VesktopNative.app.setTrayIcon("idle");
        }
    });

    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", params => {
        if (params.state === "RTC_CONNECTED") {
            isInVC = true;
            if (deafActions.isSelfDeaf()) {
                VesktopNative.app.setTrayIcon("deafened");
            } else if (muteActions.isSelfMute()) {
                VesktopNative.app.setTrayIcon("muted");
            } else {
                VesktopNative.app.setTrayIcon("idle");
            }
        } else if (params.state === "RTC_DISCONNECTED") {
            isInVC = false;
            VesktopNative.app.setTrayIcon("main");
        }
    });
});
