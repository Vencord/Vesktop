/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dialog, NativeImage, nativeImage, nativeTheme } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { BADGE_DIR, ICONS_DIR, STATIC_DIR } from "shared/paths";

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

export const isCustomIcon = (status: string) => {
    const settingKey = statusToSettingsKey[status as keyof typeof statusToSettingsKey];
    return Settings.store[settingKey];
};

export async function setTrayIcon(iconName: string) {
    if (!tray || tray.isDestroyed()) return;
    const Icons = new Set(["speaking", "muted", "deafened", "idle", "icon"]);
    if (!Icons.has(iconName)) return;

    // if need to set main icon then check whether there is need of notif badge
    if (iconName === "icon" && lastBadgeCount !== 0) {
        var trayImage: NativeImage;
        if (isCustomIcon("icon")) {
            trayImage = nativeImage.createFromPath(join(ICONS_DIR, "icon_custom.png"));
        } else {
            trayImage = nativeImage.createFromPath(join(ICONS_DIR, "icon.png"));
        }

        if (trayImage.isEmpty()) {
            const iconKey = statusToSettingsKey[iconName as keyof typeof statusToSettingsKey];
            Settings.store[iconKey] = false;
            generateTrayIcons("icon");
            return;
        }

        const badgeSvg = readFileSync(join(BADGE_DIR, `badge.svg`), "utf8");
        // and send IPC call to renderer to add badge to icon
        mainWin.webContents.send(IpcEvents.ADD_BADGE_TO_ICON, trayImage.toDataURL(), badgeSvg);
        return;
    }

    try {
        var trayImage: NativeImage;
        if (isCustomIcon(iconName)) {
            trayImage = nativeImage.createFromPath(join(ICONS_DIR, iconName + "_custom.png"));
            if (trayImage.isEmpty()) {
                const iconKey = statusToSettingsKey[iconName as keyof typeof statusToSettingsKey];
                Settings.store[iconKey] = false;
                generateTrayIcons(iconName);
                return;
            }
        } else trayImage = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
        if (trayImage.isEmpty()) {
            generateTrayIcons(iconName);
            return;
        }
        if (process.platform === "darwin") {
            trayImage = trayImage.resize({ width: 16, height: 16 });
        }
        tray.setImage(trayImage);
    } catch (error) {
        console.log("Error: ", error, "Regenerating tray icon.");
        generateTrayIcons(iconName);
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

export async function getTrayIconFile(iconName: string) {
    const Icons = new Set(["speaking", "muted", "deafened", "idle"]);
    if (!Icons.has(iconName)) {
        iconName = "icon";
        return readFile(join(STATIC_DIR, "icon.png"));
    }
    return readFile(join(STATIC_DIR, iconName + ".svg"), "utf8");
}

export function getTrayIconFileSync(iconName: string) {
    // returns dataURL of image from TrayIcons folder
    const Icons = new Set(["speaking", "muted", "deafened", "idle", "icon"]);

    if (Icons.has(iconName)) {
        var img: NativeImage;
        if (isCustomIcon(iconName)) {
            img = nativeImage.createFromPath(join(ICONS_DIR, iconName + "_custom.png"));
        } else img = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
        img = img.resize({ width: 128, height: 128 });
        if (img.isEmpty()) {
            console.log("Can't open icon file for", iconName, ". Regenerating.");
            generateTrayIcons(iconName);
            img = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
            const iconKey = statusToSettingsKey[iconName as keyof typeof statusToSettingsKey];
            Settings.store[iconKey] = false;
        }
        return img.toDataURL();
    }
}

export async function createTrayIcon(
    iconName: string,
    iconDataURL: string,
    isCustomIcon: boolean = false,
    isSvg: boolean = false
) {
    // creates .png at config/TrayIcons/iconName.png from given iconDataURL
    // primarily called from renderer using CREATE_TRAY_ICON_RESPONSE IPC call
    iconDataURL = iconDataURL.replace(/^data:image\/png;base64,/, "");
    if (isCustomIcon) {
        const img = nativeImage.createFromDataURL(iconDataURL).resize({ width: 128, height: 128 });
        if (isSvg) writeFileSync(join(ICONS_DIR, iconName + "_custom.png"), iconDataURL, "base64");
        else writeFileSync(join(ICONS_DIR, iconName + "_custom.png"), img.toPNG());
    } else {
        writeFileSync(join(ICONS_DIR, iconName + ".png"), iconDataURL, "base64");
    }
    mainWin.webContents.send(IpcEvents.SET_CURRENT_VOICE_TRAY_ICON);
}

export async function generateTrayIcons(iconName: string = "") {
    // this function generates tray icons as .png's in Vesktop cache for future use
    if (!mainWin) return;
    mkdirSync(ICONS_DIR, { recursive: true });
    const Icons = ["speaking", "muted", "deafened", "idle"];

    const createMainIcon = () => {
        const img = nativeImage.createFromPath(join(STATIC_DIR, "icon.png")).resize({ width: 128, height: 128 });
        writeFileSync(join(ICONS_DIR, "icon.png"), img.toPNG());
        mainWin.webContents.send(IpcEvents.SET_CURRENT_VOICE_TRAY_ICON);
    };

    if (iconName) {
        if (Icons.includes(iconName)) mainWin.webContents.send(IpcEvents.CREATE_TRAY_ICON_REQUEST, iconName);
        else if (iconName === "icon") createMainIcon();
        return;
    }
    for (const icon of Icons) {
        mainWin.webContents.send(IpcEvents.CREATE_TRAY_ICON_REQUEST, icon);
    }
    createMainIcon();
}

export async function pickTrayIcon(iconName: string) {
    const Icons = new Set(["speaking", "muted", "deafened", "idle", "icon"]);
    if (!Icons.has(iconName)) return;

    const res = await dialog.showOpenDialog(mainWin!, {
        properties: ["openFile"],
        filters: [{ name: "Image", extensions: ["png", "jpg", "svg"] }]
    });
    if (!res.filePaths.length) return "cancelled";
    const dir = res.filePaths[0];
    // add .svg !!
    if (dir.split(".").pop() === "svg") {
        mainWin.webContents.send(IpcEvents.CREATE_TRAY_ICON_REQUEST, iconName, readFileSync(dir, "utf-8"));
        return "svg";
    }
    const image = nativeImage.createFromPath(dir);
    if (image.isEmpty()) return "invalid";
    const img = nativeImage.createFromPath(dir).resize({ width: 128, height: 128 });
    writeFileSync(join(ICONS_DIR, iconName + "_custom.png"), img.toPNG());
    return dir;
}

export async function getIconWithBadge(dataURL: string) {
    tray.setImage(nativeImage.createFromDataURL(dataURL));
}

nativeTheme.on("updated", () => {
    generateTrayIcons();
});
