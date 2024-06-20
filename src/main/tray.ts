/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { dialog, NativeImage, nativeImage } from "electron";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { ICONS_DIR, STATIC_DIR } from "shared/paths";

import { mainWin } from "./mainWindow";
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
            console.log("Can't open icon file. Regenerating.");
            generateTrayIcons();
            img = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
            const iconKey = statusToSettingsKey[iconName as keyof typeof statusToSettingsKey];
            Settings.store[iconKey] = false;
        }
        return img.toDataURL();
    }
}

export async function createTrayIcon(iconName: string, iconDataURL: string, isCustomIcon: boolean = false) {
    // creates .png at config/TrayIcons/iconName.png from given iconDataURL
    // primarily called from renderer using CREATE_TRAY_ICON_RESPONSE IPC call
    iconDataURL = iconDataURL.replace(/^data:image\/png;base64,/, "");
    if (isCustomIcon) {
        writeFileSync(join(ICONS_DIR, iconName + "_custom.png"), iconDataURL, "base64");
    } else {
        writeFileSync(join(ICONS_DIR, iconName + ".png"), iconDataURL, "base64");
    }
    mainWin.webContents.send(IpcEvents.SET_CURRENT_VOICE_TRAY_ICON);
}

export async function generateTrayIcons() {
    // this function generates tray icons as .png's in Vesktop cache for future use
    mkdirSync(ICONS_DIR, { recursive: true });
    const Icons = ["speaking", "muted", "deafened", "idle"];
    for (const icon of Icons) {
        mainWin.webContents.send(IpcEvents.CREATE_TRAY_ICON_REQUEST, icon);
    }
    copyFileSync(join(STATIC_DIR, "icon.png"), join(ICONS_DIR, "icon.png"));
    mainWin.webContents.send(IpcEvents.SET_CURRENT_VOICE_TRAY_ICON);
}

export async function pickTrayIcon(iconName: string) {
    const Icons = new Set(["speaking", "muted", "deafened", "idle", "icon"]);
    if (!Icons.has(iconName)) return;

    const res = await dialog.showOpenDialog(mainWin!, {
        properties: ["openFile"],
        filters: [{ name: "Image", extensions: ["png", "jpg"] }]
    });
    if (!res.filePaths.length) return "cancelled";
    const dir = res.filePaths[0];
    // add .svg !!
    const image = nativeImage.createFromPath(dir);
    if (image.isEmpty()) return "invalid";
    copyFileSync(dir, join(ICONS_DIR, iconName + "_custom.png"));
    return dir;
}
