/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { BrowserWindow } from "electron";
import { SplashProps } from "shared/browserWinProperties";

import { Settings } from "./settings";
import { loadView } from "./vesktopStatic";

let splash: BrowserWindow | undefined;

export function createSplashWindow(startMinimized = false) {
    splash = new BrowserWindow({
        ...SplashProps,
        show: !startMinimized,
        webPreferences: {
            preload: join(__dirname, "splashPreload.js")
        }
    });

    const { splashBackground, splashColor, splashTheming, splashPixelated } = Settings.store;

    const params = new URLSearchParams();
    if (splashTheming) {
        if (splashColor) params.set("fg", splashColor);
        if (splashBackground) params.set("bg", splashBackground);
    }
    if (splashPixelated) params.set("pixelated", "");

    loadView(splash, "splash.html", params);

    return splash;
}

export function updateSplashMessage(message: string) {
    if (splash && !splash.isDestroyed()) splash.webContents.send("update-splash-message", message);
}
