import { BrowserWindow, Menu, Tray, app } from "electron";
import { join } from "path";

export function createMainWindow() {
    let isQuitting = false;

    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js")
        },
        icon: join(__dirname, "..", "..", "static", "icon.ico")
    });

    app.on("before-quit", () => {
        isQuitting = true;
    });

    win.on("close", e => {
        if (isQuitting) return;

        e.preventDefault();
        win.hide();

        return false;
    });

    const tray = new Tray(join(__dirname, "..", "..", "static", "icon.ico"));
    tray.setToolTip("Vencord Desktop");
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: "Open",
            click() {
                win.show();
            }
        },
        {
            label: "Quit",
            click() {
                isQuitting = true;
                app.quit();
            }
        }
    ]));
    tray.on("click", () => win.show());

    win.loadURL("https://discord.com/app");

    return win;
}
