import { BrowserWindow } from "electron";
import { join } from "path";

export function createMainWindow() {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js")
        }
    });

    win.loadURL("https://discord.com/app");

    return win;
}
