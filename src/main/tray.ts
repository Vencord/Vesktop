/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { nativeImage, nativeTheme } from "electron";
import { join } from "path";
import { ICONS_DIR } from "shared/paths";

import { lastBadgeCount } from "./appBadge";
import { tray } from "./mainWindow";
import { Settings } from "./settings";

export async function setTrayIcon(iconName: string) {
    if (!tray || tray.isDestroyed()) return;
    const Icons = new Set(["speaking", "muted", "deafened", "idle", "main"]);
    if (!Icons.has(iconName)) return;

    if (iconName === "main" && ![-1, 0].includes(lastBadgeCount)) {
        var trayImage = nativeImage.createFromPath(join(ICONS_DIR, "main_badge.png"));
        tray.setImage(trayImage);
        return;
    }

    if (
        (Settings.store.trayAutoFill === "auto" && !nativeTheme.shouldUseDarkColors) ||
        (Settings.store.trayAutoFill === "black" && ["idle", "main"].includes(iconName))
    ) {
        iconName += "_black";
    }

    var trayImage = nativeImage.createFromPath(join(ICONS_DIR, iconName + ".png"));
    if (trayImage.isEmpty()) {
        return;
    }
    if (process.platform === "darwin") {
        trayImage = trayImage.resize({ width: 16, height: 16 });
    }
    tray.setImage(trayImage);

    return;
}
