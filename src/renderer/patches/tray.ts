/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Logger } from "@vencord/types/utils";
import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const voiceActions = findByPropsLazy("isSelfMute");

export var isInCall = false;
const logger = new Logger("VesktopTrayIcon");

async function changeIconColor(iconName: string) {
    const pickedColor = VesktopNative.settings.get().trayColor;
    const fillColor = VesktopNative.settings.get().trayAutoFill ?? "auto";

    try {
        var svg = await VesktopNative.app.getTrayIcon(iconName);
        svg = svg.replace(/#f6bfac/gim, "#" + (pickedColor ?? "3DB77F"));
        if (fillColor !== "auto") {
            svg = svg.replace(/black/gim, fillColor);
            svg = svg.replace(/white/gim, fillColor);
        }
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const img = new Image();
        img.width = 128;
        img.height = 128;
        img.onload = () => {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                const dataURL = canvas.toDataURL("image/png");
                VesktopNative.app.setTrayIcon(dataURL);
            }
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (error) {
        logger.error("Error: ", error);
    }
}

export function setCurrentTrayIcon() {
    if (voiceActions.isSelfDeaf()) {
        changeIconColor("deafened");
    } else if (voiceActions.isSelfMute()) {
        changeIconColor("muted");
    } else {
        changeIconColor("idle");
    }
}

onceReady.then(() => {
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID) {
            if (params.speakingFlags) {
                changeIconColor("speaking");
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
        if (params.state === "RTC_CONNECTED") {
            isInCall = true;
            setCurrentTrayIcon();
        } else if (params.state === "RTC_DISCONNECTED") {
            VesktopNative.app.setTrayIcon("icon");
            isInCall = false;
        }
    });
});
