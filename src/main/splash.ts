import { BrowserWindow } from "electron";
import { join } from "path";
import { STATIC_DIR } from "shared/paths";

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

    splash.loadFile(join(STATIC_DIR, "splash.html"));

    return splash;
}
