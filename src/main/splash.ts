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

export let splash: BrowserWindow;

export function createSplashWindow(startMinimized = false) {
    const { splashBackground, splashColor, splashTheming, splashAnimationPath, splashDetailed } = Settings.store;

    if (splashDetailed) {
        splash = new BrowserWindow({
            ...SplashProps,
            icon: ICON_PATH,
            show: !startMinimized,
            height: 400,
            width: 500,
            closable: false
        });

        splash.loadFile(join(VIEW_DIR, "splash_v2.html"));
    } else {
        splash = new BrowserWindow({
            ...SplashProps,
            icon: ICON_PATH,
            show: !startMinimized,
            width: 300,
            closable: false
        });

        splash.loadFile(join(VIEW_DIR, "splash.html"));
    }

    if (splashTheming) {
        if (splashColor) {
            const semiTransparentSplashColor = splashColor.replace("rgb(", "rgba(").replace(")", ", 0.2)");

            splash.webContents.insertCSS(`body { --fg: ${splashColor} !important }`);
            splash.webContents.insertCSS(`body { --fg-semi-trans: ${semiTransparentSplashColor} !important }`);
        }

        if (splashBackground) {
            splash.webContents.insertCSS(`body { --bg: ${splashBackground} !important }`);
        }
    }

    if (splashAnimationPath) {
        splash.webContents.executeJavaScript(`
            document.getElementById("animation").src = "splash-animation://img";
        `);
    } else {
        splash.webContents.insertCSS(`img {image-rendering: pixelated}`);
        splash.webContents.executeJavaScript(`
            document.getElementById("animation").src = "../viggy.gif";
        `);
    }
    return splash;
}
