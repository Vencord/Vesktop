/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow } from "electron";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { ICON_PATH, VIEW_DIR } from "shared/paths";

import { Settings } from "./settings";

let splash: BrowserWindow | undefined;

export function createSplashWindow(startMinimized = false) {
    splash = new BrowserWindow({
        ...SplashProps,
        icon: ICON_PATH,
        show: !startMinimized,
        webPreferences: {
            preload: join(__dirname, "splashPreload.js")
        }
    });

    splash.loadFile(join(VIEW_DIR, "splash.html"));

    const { splashBackground, splashColor, splashTheming } = Settings.store;

    if (splashTheming !== false) {
        if (splashColor) {
            const semiTransparentSplashColor = splashColor.replace("rgb(", "rgba(").replace(")", ", 0.2)");

            splash.webContents.insertCSS(`body { --fg: ${splashColor} !important }`);
            splash.webContents.insertCSS(`body { --fg-semi-trans: ${semiTransparentSplashColor} !important }`);
        }

        if (splashBackground) {
            splash.webContents.insertCSS(`body { --bg: ${splashBackground} !important }`);
        }
    }

    return splash;
}

export function updateSplashMessage(message: string) {
    if (splash && !splash.isDestroyed()) splash.webContents.send("update-splash-message", message);
}
