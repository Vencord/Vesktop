/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { BrowserWindow } from "electron";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { ICON_PATH, VIEW_DIR } from "shared/paths";

import { Settings } from "./settings";

export function patchVencordView(view: BrowserWindow) {
    const { splashBackground, splashColor, splashTheming } = Settings.store;

    if (splashTheming) {
        if (splashColor) {
            const semiTransparentSplashColor = splashColor.replace("rgb(", "rgba(").replace(")", ", 0.2)");

            view.webContents.insertCSS(`body { --fg: ${splashColor} !important }`);
            view.webContents.insertCSS(`body { --fg-semi-trans: ${semiTransparentSplashColor} !important }`);
        }

        if (splashBackground) {
            view.webContents.insertCSS(`body { --bg: ${splashBackground} !important }`);
        }
    }
}

export function createSplashWindow() {
    const splash = new BrowserWindow({
        ...SplashProps,
        icon: ICON_PATH
    });

    splash.loadFile(join(VIEW_DIR, "splash.html"));
    patchVencordView(splash);

    return splash;
}
