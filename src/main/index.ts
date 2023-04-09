/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./ipc";

import { app, BrowserWindow } from "electron";
import { join } from "path";

import { ICON_PATH } from "../shared/paths";
import { once } from "../shared/utils/once";
import { DATA_DIR, VENCORD_FILES_DIR } from "./constants";
import { createMainWindow } from "./mainWindow";
import { Settings } from "./settings";
import { createSplashWindow } from "./splash";
import { ensureVencordFiles } from "./utils/vencordLoader";
if (IS_DEV) {
    require("source-map-support").install();
}

// Make the Vencord files use our DATA_DIR
process.env.VENCORD_USER_DATA_DIR = DATA_DIR;

const runVencordMain = once(() => require(join(VENCORD_FILES_DIR, "vencordDesktopMain.js")));

let mainWin: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
    console.log("Vencord Desktop is already running. Quitting...");
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWin) {
            if (mainWin.isMinimized()) mainWin.restore();
            if (!mainWin.isVisible()) mainWin.show();
            mainWin.focus();
        }
    });

    app.whenReady().then(async () => {
        if (process.platform === "win32") app.setAppUserModelId("dev.vencord.desktop");
        else if (process.platform === "darwin") app.dock.setIcon(ICON_PATH);

        createWindows();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindows();
        });
    });
}

async function createWindows() {
    const splash = createSplashWindow();

    await ensureVencordFiles();
    runVencordMain();

    mainWin = createMainWindow();

    mainWin.once("ready-to-show", () => {
        splash.destroy();
        mainWin!.show();

        if (Settings.maximized) {
            mainWin!.maximize();
        }
    });
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
