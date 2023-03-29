import { BrowserWindow } from "electron";
import { join } from "path";

export function createSplashWindow() {
    const splash = new BrowserWindow({
        transparent: true,
        frame: false,
        height: 350,
        width: 300,
        center: true,
        resizable: false,
        maximizable: false
    });

    splash.loadFile(join(__dirname, "..", "static", "splash.html"));

    return splash;
}
