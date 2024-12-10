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

function changeColorsInSvg(svg: string, stockColor: string, accentColor: string = "f6bfac") {
    const Settings = VesktopNative.settings.get();
    if (Settings.trayColorType === "default") return svg;
    const pickedColor = Settings.trayColorType === "system" ? accentColor : Settings.trayColor || accentColor;
    const fillColor = Settings.trayAutoFill ?? "auto";
    const reg = new RegExp(stockColor, "gim");
    svg = svg.replace(reg, "#" + (pickedColor ?? stockColor));
    if (fillColor === "white") {
        svg = svg.replace(/black/gim, fillColor);
    } else if (fillColor === "black") {
        svg = svg.replace(/white/gim, fillColor);
    }
    return svg;
}

VesktopNative.tray.createIconRequest(async (iconName: string, svgIcon: string = "") => {
    try {
        var svg = svgIcon || (await VesktopNative.tray.getIcon(iconName));
        svg = changeColorsInSvg(svg, "#f6bfac", (await VesktopNative.app.getAccentColor()).substring(1));

        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svg, "image/svg+xml");
        const svgElement = svgDoc.documentElement;

        if (!svgElement.hasAttribute("viewBox")) {
            const width = parseFloat(svgElement.getAttribute("width") || "128");
            const height = parseFloat(svgElement.getAttribute("height") || "128");
            svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
        }
        svg = new XMLSerializer().serializeToString(svgElement);

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const img = new Image();
        img.onload = () => {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const scaleX = canvas.width / img.width;
                const scaleY = canvas.height / img.height;
                const scale = Math.max(scaleX, scaleY);

                const scaledWidth = img.width * scale;
                const scaledHeight = img.height * scale;

                const offsetX = (canvas.width - scaledWidth) / 2;
                const offsetY = (canvas.height - scaledHeight) / 2;
                ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

                const dataURL = canvas.toDataURL("image/png");
                const isSvg = svgIcon !== "";
                VesktopNative.tray.createIconResponse(iconName, dataURL, isSvg, isSvg); // custom if svgIcon is provided
            }
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (error) {
        logger.error("Error: ", error);
    }
});

VesktopNative.tray.addBadgeToIcon(async (iconDataURL: string, badgeDataSVG: string) => {
    badgeDataSVG = changeColorsInSvg(badgeDataSVG, "#f6bfac", (await VesktopNative.app.getAccentColor()).substring(1));

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
        if (params.userId === userID && params.context === "default") {
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
        if (params.state === "RTC_CONNECTED" && params.context === "default") {
            isInCall = true;
            setCurrentTrayIcon();
        } else if (params.state === "RTC_DISCONNECTED" && params.context === "default") {
            VesktopNative.tray.setIcon("icon");
            isInCall = false;
        }
    });
});
