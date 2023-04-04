import { app, BrowserWindow } from 'electron';
import { createMainWindow } from "./mainWindow";
import { createSplashWindow } from "./splash";

import { join } from "path";

import { DATA_DIR, VENCORD_FILES_DIR } from "./constants";

import { once } from "../shared/utils/once";
import { ensureVencordFiles } from "./utils/vencordLoader";

import { ICON_PATH } from "../shared/paths";
import "./ipc";
import { Settings } from "./settings";

// Make the Vencord files use our DATA_DIR
process.env.VENCORD_USER_DATA_DIR = DATA_DIR;

const runVencordMain = once(() => require(join(VENCORD_FILES_DIR, "main.js")));

let mainWin: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
    console.log("Vencord Desktop is already running. Quitting...");
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWin) {
            if (mainWin.isMinimized()) mainWin.restore();
            mainWin.focus();
        }
    });

    app.whenReady().then(async () => {
        if (process.platform === "darwin")
            app.dock.setIcon(ICON_PATH);

        createWindows();

        app.on('activate', () => {
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
    if (process.platform !== "darwin")
        app.quit();
});
