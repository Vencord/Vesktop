/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { nativeImage, nativeTheme } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { BADGE_DIR, ICONS_DIR } from "shared/paths";

import { lastBadgeCount } from "./appBadge";
import { mainWin, tray } from "./mainWindow";
import { Settings } from "./settings";

export const statusToSettingsKey = {
    speaking: "traySpeakingOverride",
    muted: "trayMutedOverride",
    deafened: "trayDeafenedOverride",
    idle: "trayIdleOverride",
    icon: "trayMainOverride"
};

export async function setTrayIcon(iconName: string) {
    if (!tray || tray.isDestroyed()) return;

    const Icons = new Set(["speaking", "muted", "deafened", "idle", "icon"]);
    if (!Icons.has(iconName)) return;

    if (iconName === "icon" && lastBadgeCount !== 0) {
        var trayImage = nativeImage.createFromPath(join(ICONS_DIR, "icon.png"));
        const badgeSvg = readFileSync(join(BADGE_DIR, `badge.svg`), "utf8");
        // and send IPC call to renderer to add badge to icon
        mainWin.webContents.send(IpcEvents.ADD_BADGE_TO_ICON, trayImage.toDataURL(), badgeSvg);
        return;
    }

    if (
        (Settings.store.trayAutoFill === "auto" && !nativeTheme.shouldUseDarkColors) ||
        (Settings.store.trayAutoFill === "black" && iconName !== "idle")
    ) {
        iconName += "_black";
    }

    try {
        var trayImage = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
        if (trayImage.isEmpty()) {
            return;
        }
        if (process.platform === "darwin") {
            trayImage = trayImage.resize({ width: 16, height: 16 });
        }
        tray.setImage(trayImage);
    } catch (error) {
        console.log("Error: ", error);
    }
    return;
}

export async function setTrayIconWithBadge(iconDataURL: string) {
    var trayImage = nativeImage.createFromDataURL(iconDataURL);
    if (process.platform === "darwin") {
        trayImage = trayImage.resize({ width: 16, height: 16 });
    }
    tray.setImage(trayImage);
}

export async function getIconWithBadge(dataURL: string) {
    tray.setImage(nativeImage.createFromDataURL(dataURL));
}
