/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./ipc";

import {app, BrowserWindow, systemPreferences} from "electron";
import { checkUpdates } from "updater/main";

import { DATA_DIR } from "./constants";
import { createFirstLaunchTour } from "./firstLaunch";
import { createWindows, mainWin } from "./mainWindow";
import { registerScreenShareHandler } from "./screenShare";
import { Settings } from "./settings";

if (IS_DEV) {
    require("source-map-support").install();
}

// Make the Vencord files use our DATA_DIR
process.env.VENCORD_USER_DATA_DIR = DATA_DIR;

function init() {
    // work around chrome 66 disabling autoplay by default
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

    // WinRetrieveSuggestionsOnlyOnDemand: Work around electron 13 bug w/ async spellchecking on Windows.
    // HardwareMediaKeyHandling,MediaSessionService: Prevent Discord from registering as a media service.
    //
    // WidgetLayering (Vencord Added): Fix DevTools context menus https://github.com/electron/electron/issues/38790
    app.commandLine.appendSwitch(
        "disable-features",
        "WinRetrieveSuggestionsOnlyOnDemand,HardwareMediaKeyHandling,MediaSessionService,WidgetLayering"
    );

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

        registerScreenShareHandler();
        bootstrap();
        
        //TODO we should only ask these permissions when the user joins a voice chat/video call for the first time
        //TODO we should also handle the granted result respectively. How does this official client handle permissions?
        systemPreferences.askForMediaAccess('microphone')
            .then((granted) => console.log(`microphone permission granted: ${granted}`));
        systemPreferences.askForMediaAccess('camera')
            .then((granted) => console.log(`camera permission granted: ${granted}`)); //TODO we should only ask this permission when the user joins a video call for the first time


        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindows();
        });
    });
}

if (!app.requestSingleInstanceLock({ IS_DEV })) {
    if (IS_DEV) {
        console.log("Vesktop is already running. Quitting previous instance...");
        init();
    } else {
        console.log("Vesktop is already running. Quitting...");
        app.quit();
    }
} else {
    init();
}

async function bootstrap() {
    if (!Object.hasOwn(Settings.store, "firstLaunch")) {
        createFirstLaunchTour();
    } else {
        createWindows();
    }
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
