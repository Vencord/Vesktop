import { BrowserWindow, Menu, Tray, app, shell } from "electron";
import { join } from "path";
import { ICON_PATH } from "../shared/paths";

let isQuitting = false;

app.on("before-quit", () => {
    isQuitting = true;
});

function initWindowOpenHandler(win: BrowserWindow) {
    win.webContents.setWindowOpenHandler(({ url }) => {
        switch (url) {
            case "about:blank":
            case "https://discord.com/popout":
                return { action: "allow" };
        }

        try {
            var protocol = new URL(url).protocol;
        } catch {
            return { action: "deny" };
        }

        switch (protocol) {
            case "http:":
            case "https:":
            case "mailto:":
            case "steam:":
            case "spotify:":
                shell.openExternal(url);
        }

        return { action: "deny" };
    });
}

function initTray(win: BrowserWindow) {
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

    win.on("show", () => {
        trayMenu.items[0].enabled = false;
    });

    win.on("hide", () => {
        trayMenu.items[0].enabled = true;
    });
}

export function createMainWindow() {
    const win = new BrowserWindow({
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js")
        },
        icon: ICON_PATH
    });

    // le epic crapple moment
    if (process.platform === "darwin")
        app.dock.setIcon(ICON_PATH);

    win.on("close", e => {
        if (isQuitting) return;

        e.preventDefault();
        win.hide();

        return false;
    });

    initTray(win);
    initWindowOpenHandler(win);

    win.loadURL("https://discord.com/app");

    return win;
}
