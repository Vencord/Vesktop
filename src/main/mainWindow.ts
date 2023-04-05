import { BrowserWindow, BrowserWindowConstructorOptions, Menu, Tray, app } from "electron";
import { join } from "path";
import { ICON_PATH } from "../shared/paths";
import { createAboutWindow } from "./about";
import { Settings } from "./settings";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { downloadVencordFiles } from "./utils/vencordLoader";

let isQuitting = false;

app.on("before-quit", () => {
    isQuitting = true;
});

export let mainWin: BrowserWindow;

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
            label: "About",
            click: createAboutWindow
        },
        {
            label: "Force Update Vencord",
            async click() {
                await downloadVencordFiles();
                app.relaunch();
                app.quit();
            }
        },
        {
            label: "Relaunch",
            click() {
                app.relaunch();
                app.quit();
            }
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

function initMenuBar(win: BrowserWindow) {
    console.log(process.platform);
    const menu = Menu.buildFromTemplate([
        {
            label: "Vencord Desktop",
            submenu: [
                {
                    label: "About Vencord Desktop",
                    click: createAboutWindow
                },
                {
                    label: "Force Update Vencord",
                    async click() {
                        await downloadVencordFiles();
                        app.relaunch();
                        app.quit();
                    },
                    toolTip: "Vencord Desktop will automatically restart after this operation"
                },
                {
                    label: "Toggle Developer Tools",
                    accelerator: "CmdOrCtrl+Shift+I",
                    click() {
                        BrowserWindow.getFocusedWindow()!.webContents.toggleDevTools();
                    }
                },
                {
                    label: "Toggle Developer Tools (Hidden)",
                    accelerator: "F12",
                    visible: false,
                    click() {
                        BrowserWindow.getFocusedWindow()!.webContents.toggleDevTools();
                    }
                },
                {
                    label: "Reload Window",
                    accelerator: "CmdOrCtrl+R",
                    click() {
                        BrowserWindow.getFocusedWindow()!.webContents.reload();
                    }
                },
                {
                    label: "Relaunch",
                    accelerator: "CmdOrCtrl+Shift+R",
                    click() {
                        app.relaunch();
                        app.quit();
                    }
                },
                {
                    label: "Quit",
                    accelerator: process.platform === "win32" ? void 0 : "CmdOrCtrl+Q",
                    // TODO: Setting
                    visible: process.platform !== "win32",
                    click() {
                        app.quit();
                    }
                },
                {
                    label: "Quit",
                    accelerator: "Alt+F4",
                    visible: process.platform === "win32",
                    acceleratorWorksWhenHidden: false,
                    click() {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: "Zoom",
            submenu: [
                {
                    label: "Zoom in",
                    accelerator: "CmdOrCtrl+Plus",
                    role: "zoomIn"
                },
                // Fix for zoom in on keyboards with dedicated + like QWERTZ (or numpad)
                // See https://github.com/electron/electron/issues/14742 and https://github.com/electron/electron/issues/5256
                {
                    label: "Zoom in",
                    accelerator: "CmdOrCtrl+=",
                    role: "zoomIn",
                    visible: false
                },
                {
                    label: "Zoom out",
                    accelerator: "CmdOrCtrl+-",
                    role: "zoomOut"
                }
            ]
        }
    ]);

    Menu.setApplicationMenu(menu);
}

function getWindowBoundsOptions() {
    const options = {} as BrowserWindowConstructorOptions;

    const { x, y, width, height } = Settings.windowBounds ?? {};
    if (x != null && y != null) {
        options.x = x;
        options.y = y;
    }

    if (width) options.width = width;
    if (height) options.height = height;

    return options;
}

function initWindowBoundsListeners(win: BrowserWindow) {
    win.on("maximize", () => {
        Settings.maximized = true;
        Settings.minimized = false;
    });

    win.on("minimize", () => {
        Settings.minimized = true;
    });

    win.on("unmaximize", () => {
        Settings.maximized = false;
        Settings.minimized = false;
    });

    const saveBounds = () => {
        const [width, height] = win.getSize();
        const [x, y] = win.getPosition();

        Settings.windowBounds = {
            width,
            height,
            x,
            y
        };
    };

    win.on("resize", saveBounds);
    win.on("move", saveBounds);
}

export function createMainWindow() {
    const win = mainWin = new BrowserWindow({
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js")
        },
        icon: ICON_PATH,
        ...getWindowBoundsOptions()
    });

    win.on("close", e => {
        if (isQuitting) return;

        e.preventDefault();
        win.hide();

        return false;
    });

    initWindowBoundsListeners(win);
    initTray(win);
    initMenuBar(win);
    makeLinksOpenExternally(win);

    const subdomain = Settings.discordBranch === "canary" || Settings.discordBranch === "ptb"
        ? `${Settings.discordBranch}.`
        : "";

    win.loadURL(`https://${subdomain}discord.com/app`);

    return win;
}
