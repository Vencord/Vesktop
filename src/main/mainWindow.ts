import { BrowserWindow, Menu, Tray, app } from "electron";
import { join } from "path";
import { ICON_PATH } from "../shared/paths";

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
        icon: ICON_PATH
    });

    const trayMenu = Menu.buildFromTemplate([
        {
            label: "Open",
            click() {
                win.show();
            },
            enabled: false
        },
        {
            label: "Quit Vencord Desktop",
            click() {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    const tray = new Tray(ICON_PATH);
    tray.setToolTip("Vencord Desktop");
    tray.setContextMenu(trayMenu);
    tray.on("click", () => win.show());

    app.on("before-quit", () => {
        isQuitting = true;
    });

    win.on("close", e => {
        if (isQuitting) return;

        e.preventDefault();
        win.hide();

        return false;
    });

    win.on("show", () => {
        trayMenu.items[0].enabled = false;
    });

    win.on("hide", () => {
        trayMenu.items[0].enabled = true;
    });


    win.loadURL("https://discord.com/app");

    return win;
}
