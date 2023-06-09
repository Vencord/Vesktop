/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./ipc";

import { app, BrowserWindow } from "electron";
import { join } from "path";
import { checkUpdates } from "updater/main";

import { ICON_PATH } from "../shared/paths";
import { once } from "../shared/utils/once";
import { initArRPC } from "./arrpc";
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

function init() {
    // <-- BEGIN COPY PASTED FROM DISCORD -->

    // work around chrome 66 disabling autoplay by default
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

    // WinRetrieveSuggestionsOnlyOnDemand: Work around electron 13 bug w/ async spellchecking on Windows.
    // HardwareMediaKeyHandling,MediaSessionService: Prevent Discord from registering as a media service.
    app.commandLine.appendSwitch(
        "disable-features",
        "WinRetrieveSuggestionsOnlyOnDemand,HardwareMediaKeyHandling,MediaSessionService"
    );

    // <-- END COPY PASTED FROM DISCORD -->

    app.on("second-instance", (_event, _cmdLine, _cwd, data: any) => {
        if (data.IS_DEV) app.quit();
        else if (mainWin) {
            if (mainWin.isMinimized()) mainWin.restore();
            if (!mainWin.isVisible()) mainWin.show();
            mainWin.focus();
        }
    });

    app.whenReady().then(async () => {
        checkUpdates();
        if (process.platform === "win32") app.setAppUserModelId("dev.vencord.desktop");
        else if (process.platform === "darwin") app.dock.setIcon(ICON_PATH);

        createWindows();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindows();
        });
    });
}

if (!app.requestSingleInstanceLock({ IS_DEV })) {
    if (IS_DEV) {
        console.log("Vencord Desktop is already running. Quitting previous instance...");
        init();
    } else {
        console.log("Vencord Desktop is already running. Quitting...");
        app.quit();
    }
} else {
    init();
}

async function createWindows() {
    const splash = createSplashWindow();

    await ensureVencordFiles();
    runVencordMain();

    mainWin = createMainWindow();

    mainWin.once("ready-to-show", () => {
        splash.destroy();
        mainWin!.show();

        if (Settings.store.maximized) {
            mainWin!.maximize();
        }
    });

    initArRPC();
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
