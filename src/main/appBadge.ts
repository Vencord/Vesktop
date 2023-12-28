/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, NativeImage, nativeImage } from "electron";
import { join } from "path";
import { BADGE_DIR, TRAY_ICON_DIR, TRAY_ICON_PATH } from "shared/paths";
import { tray, mainWin } from "./mainWindow";
import { Settings } from "./settings";

const imgCache = new Map<string, NativeImage>();

function loadImg(path: string) {
    const cached = imgCache.get(path);
    if (cached) return cached;

    const img = nativeImage.createFromPath(path);
    imgCache.set(path, img);

    return img;
}

function loadBadge(index: number) {
    return loadImg(join(BADGE_DIR, `${index}.ico`));
}

function loadTrayIcon(index: number) {
    return loadImg(index === 0 ? TRAY_ICON_PATH : join(TRAY_ICON_DIR, `icon_${index}.png`));
}

let lastIndex: null | number = -1;

export function setBadgeCount(count: number) {
    const [index, description] = getBadgeIndexAndDescription(count);

    if (Settings.store.trayBadge) {
        tray?.setImage(loadTrayIcon(index ?? 0));
    }

    if (!Settings.store.appBadge) return;

    switch (process.platform) {
        case "linux":
            if (count === -1) count = 0;
            app.setBadgeCount(count); // Only works if libunity is installed
            break;
        case "darwin":
            if (count === 0) {
                app.dock.setBadge("");
                break;
            }
            app.dock.setBadge(count === -1 ? "•" : count.toString());
            break;
        case "win32":
            if (lastIndex === index) break;

            lastIndex = index;

            mainWin.setOverlayIcon(index === null ? null : loadBadge(index), description);
            break;
    }
}

function getBadgeIndexAndDescription(count: number): [number | null, string] {
    if (count === -1) return [11, "Unread Messages"];
    if (count === 0) return [null, "No Notifications"];

    const index = Math.max(1, Math.min(count, 10));
    return [index, `${index} Notification`];
}
