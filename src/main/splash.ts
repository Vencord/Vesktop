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

const totalTasks = 12;
let doneTasks = 0;

export function createSplashWindow(startMinimized = false) {
    const { splashBackground, splashColor, splashTheming, splashAnimationPath, splashProgress } = Settings.store;

    splash = new BrowserWindow({
        ...SplashProps,
        icon: ICON_PATH,
        show: !startMinimized,
        width: 300
    });

    splash.loadFile(join(VIEW_DIR, "splash.html"));

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
            document.getElementById("animation").src = "../troll.gif";
        `);
    }

    if (splashProgress) {
        splash.webContents.executeJavaScript(`
            document.getElementById("progress-percentage").innerHTML = "${doneTasks}%";
        `);
    } else {
        splash.webContents.executeJavaScript(`
            document.getElementById("progress-section").style.display = "none";
        `);
    }

    return splash;
}

/**
 * Adds a new log count to the splash
 */
export function addSplashLog() {
    if (!splash.isDestroyed()) {
        doneTasks++;
        const completedNum = (doneTasks / totalTasks).toFixed(2);
        splash.webContents.executeJavaScript(`
            document.getElementById("progress").style.width = "${Number(completedNum) * 100}%";
            document.getElementById("progress-percentage").innerHTML = "${Number(completedNum) * 100}%";
        `);
    }
}

/**
 * Returns the splash window
 */
export function getSplash() {
    return splash;
}
