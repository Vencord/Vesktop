import { app, BrowserWindow } from 'electron';
import { createMainWindow } from "./mainWindow";
import { createSplashWindow } from "./splash";

import { join } from "path";
import "./ipc";

require(join(__dirname, "Vencord/main.js"));

function createWindows() {
    const mainWindow = createMainWindow();
    const splash = createSplashWindow();

    mainWindow.once("ready-to-show", () => {
        splash.destroy();
        mainWindow.show();
    });
}

app.whenReady().then(() => {
    createWindows();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindows();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});
