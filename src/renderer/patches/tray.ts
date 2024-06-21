/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Logger } from "@vencord/types/utils";
import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const voiceActions = findByPropsLazy("isSelfMute");

var isInCall = false;
const logger = new Logger("VesktopTrayIcon");

export function setCurrentTrayIcon() {
    if (isInCall) {
        if (voiceActions.isSelfDeaf()) {
            VesktopNative.tray.setIcon("deafened");
        } else if (voiceActions.isSelfMute()) {
            VesktopNative.tray.setIcon("muted");
        } else {
            VesktopNative.tray.setIcon("idle");
        }
    } else {
        VesktopNative.tray.setIcon("icon");
    }
}

function backgroundTooBright(color: string) {
    // calculate relative luminance
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    if (!result) {
        return false;
    }
    const normalizedR = parseInt(result[1], 16) / 255;
    const normalizedG = parseInt(result[2], 16) / 255;
    const normalizedB = parseInt(result[3], 16) / 255;
    const lumR = normalizedR <= 0.03928 ? normalizedR / 12.92 : Math.pow((normalizedR + 0.055) / 1.055, 2.4);
    const lumG = normalizedG <= 0.03928 ? normalizedG / 12.92 : Math.pow((normalizedG + 0.055) / 1.055, 2.4);
    const lumB = normalizedB <= 0.03928 ? normalizedB / 12.92 : Math.pow((normalizedB + 0.055) / 1.055, 2.4);

    return 0.2126 * lumR + 0.7152 * lumG + 0.0722 * lumB > 0.5;
}

function changeColorsInSvg(svg: string, stockColor: string, isBadge: boolean = false) {
    const pickedColor = VesktopNative.settings.get().trayColor;
    const reg = new RegExp(stockColor, "gim");
    svg = svg.replace(reg, "#" + (pickedColor ?? stockColor));
    if (backgroundTooBright(pickedColor ?? stockColor)) svg = svg.replace(/white/gim, "black");

    return svg;
}

VesktopNative.tray.createIconRequest(async (iconName: string) => {
    try {
        var svg = await VesktopNative.tray.getIcon(iconName);
        svg = changeColorsInSvg(svg, "#f6bfac");
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
                VesktopNative.tray.createIconResponse(iconName, dataURL, false);
            }
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (error) {
        logger.error("Error: ", error);
    }
});

VesktopNative.tray.addBadgeToIcon(async (iconDataURL: string, badgeDataSVG: string) => {
    const pickedColor = VesktopNative.settings.get().trayColor;
    const fillColor = VesktopNative.settings.get().trayAutoFill ?? "white";
    badgeDataSVG = changeColorsInSvg(badgeDataSVG, "#F35959");
    if (fillColor !== "auto") badgeDataSVG = badgeDataSVG.replace(/white/gim, fillColor);

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

            const iconImg = new Image();
            iconImg.width = 64;
            iconImg.height = 64;

            iconImg.onload = () => {
                ctx.drawImage(iconImg, 64, 0, 64, 64);
                VesktopNative.tray.returnIconWithBadge(canvas.toDataURL());
            };

            iconImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeDataSVG)}`;
        }
    };

    img.src = iconDataURL;
});

VesktopNative.tray.setCurrentVoiceIcon(() => {
    setCurrentTrayIcon();
});

onceReady.then(() => {
    VesktopNative.tray.generateTrayIcons();
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID) {
            if (params.speakingFlags) {
                VesktopNative.tray.setIcon("speaking");
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
            VesktopNative.tray.setIcon("icon");
            isInCall = false;
        }
    });
});
