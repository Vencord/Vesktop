/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import {
    app,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    dialog,
    Menu,
    MenuItemConstructorOptions,
    nativeTheme,
    Tray
} from "electron";
import { rm } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { isTruthy } from "shared/utils/guards";
import { once } from "shared/utils/once";
import type { SettingsStore } from "shared/utils/SettingsStore";

import { ICON_PATH } from "../shared/paths";
import { createAboutWindow } from "./about";
import { initArRPC } from "./arrpc";
import {
    DATA_DIR,
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    MessageBoxChoice,
    MIN_HEIGHT,
    MIN_WIDTH,
    UserAgent,
    VENCORD_FILES_DIR
} from "./constants";
import { Settings, VencordSettings } from "./settings";
import { createSplashWindow } from "./splash";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { applyDeckKeyboardFix, askToApplySteamLayout, isDeckGameMode } from "./utils/steamOS";
import { downloadVencordFiles, ensureVencordFiles } from "./utils/vencordLoader";

let isQuitting = false;
let tray: Tray;

applyDeckKeyboardFix();

app.on("before-quit", () => {
    isQuitting = true;
});

export let mainWin: BrowserWindow;

function makeSettingsListenerHelpers<O extends object>(o: SettingsStore<O>) {
    const listeners = new Map<(data: any) => void, PropertyKey>();

    const addListener: typeof o.addChangeListener = (path, cb) => {
        listeners.set(cb, path);
        o.addChangeListener(path, cb);
    };
    const removeAllListeners = () => {
        for (const [listener, path] of listeners) {
            o.removeChangeListener(path as any, listener);
        }

        listeners.clear();
    };

    return [addListener, removeAllListeners] as const;
}

const [addSettingsListener, removeSettingsListeners] = makeSettingsListenerHelpers(Settings);
const [addVencordSettingsListener, removeVencordSettingsListeners] = makeSettingsListenerHelpers(VencordSettings);

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
            label: "Update Vencord",
            async click() {
                await downloadVencordFiles();
                app.relaunch();
                app.quit();
            }
        },
        {
            label: "Reset Vesktop",
            async click() {
                await clearData(win);
            }
        },
        {
            type: "separator"
        },
        {
            label: "Relaunch",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        {
            label: "Quit Vesktop",
            click() {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray = new Tray(ICON_PATH);
    tray.setToolTip("Vesktop");
    tray.setContextMenu(trayMenu);
    tray.on("click", () => win.show());

    win.on("show", () => {
        trayMenu.items[0].enabled = false;
    });

    win.on("hide", () => {
        trayMenu.items[0].enabled = true;
    });
}

async function clearData(win: BrowserWindow) {
    const { response } = await dialog.showMessageBox(win, {
        message: "Are you sure you want to reset Vesktop?",
        detail: "This will log you out, clear caches and reset all your settings!\n\nVesktop will automatically restart after this operation.",
        buttons: ["Yes", "No"],
        cancelId: MessageBoxChoice.Cancel,
        defaultId: MessageBoxChoice.Default,
        type: "warning"
    });

    if (response === MessageBoxChoice.Cancel) return;

    win.close();

    await win.webContents.session.clearStorageData();
    await win.webContents.session.clearCache();
    await win.webContents.session.clearCodeCaches({});
    await rm(DATA_DIR, { force: true, recursive: true });

    app.relaunch();
    app.quit();
}

type MenuItemList = Array<MenuItemConstructorOptions | false>;

function initMenuBar(win: BrowserWindow) {
    const isWindows = process.platform === "win32";
    const isDarwin = process.platform === "darwin";
    const wantCtrlQ = !isWindows || VencordSettings.store.winCtrlQ;

    const subMenu = [
        {
            label: "About Vesktop",
            click: createAboutWindow
        },
        {
            label: "Force Update Vencord",
            async click() {
                await downloadVencordFiles();
                app.relaunch();
                app.quit();
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Reset Vesktop",
            async click() {
                await clearData(win);
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Relaunch",
            accelerator: "CmdOrCtrl+Shift+R",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        ...(!isDarwin
            ? []
            : ([
                  {
                      type: "separator"
                  },
                  {
                      label: "Settings",
                      accelerator: "CmdOrCtrl+,",
                      async click() {
                          mainWin.webContents.executeJavaScript(
                              "Vencord.Webpack.Common.SettingsRouter.open('My Account')"
                          );
                      }
                  },
                  {
                      type: "separator"
                  },
                  {
                      label: "Hide Vesktop", // Should probably remove the label, but it says "Hide VencordDesktop" instead of "Hide Vesktop"
                      role: "hide"
                  },
                  {
                      role: "hideOthers"
                  },
                  {
                      role: "unhide"
                  },
                  {
                      type: "separator"
                  }
              ] satisfies MenuItemList)),
        {
            label: "Quit",
            accelerator: wantCtrlQ ? "CmdOrCtrl+Q" : void 0,
            visible: !isWindows,
            role: "quit",
            click() {
                app.quit();
            }
        },
        isWindows && {
            label: "Quit",
            accelerator: "Alt+F4",
            role: "quit",
            click() {
                app.quit();
            }
        },
        // See https://github.com/electron/electron/issues/14742 and https://github.com/electron/electron/issues/5256
        {
            label: "Zoom in (hidden, hack for Qwertz and others)",
            accelerator: "CmdOrCtrl+=",
            role: "zoomIn",
            visible: false
        }
    ] satisfies MenuItemList;

    const menu = Menu.buildFromTemplate([
        {
            label: "Vesktop",
            role: "appMenu",
            submenu: subMenu.filter(isTruthy)
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" }
    ]);

    Menu.setApplicationMenu(menu);
}

function getWindowBoundsOptions(): BrowserWindowConstructorOptions {
    // We want the default window behaivour to apply in game mode since it expects everything to be fullscreen and maximized.
    if (isDeckGameMode) return {};

    const { x, y, width, height } = Settings.store.windowBounds ?? {};

    const options = {
        width: width ?? DEFAULT_WIDTH,
        height: height ?? DEFAULT_HEIGHT
    } as BrowserWindowConstructorOptions;

    if (x != null && y != null) {
        options.x = x;
        options.y = y;
    }

    if (!Settings.store.disableMinSize) {
        options.minWidth = MIN_WIDTH;
        options.minHeight = MIN_HEIGHT;
    }

    return options;
}

function getDarwinOptions(): BrowserWindowConstructorOptions {
    const options = {
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 10, y: 10 }
    } as BrowserWindowConstructorOptions;

    const { splashTheming, splashBackground } = Settings.store;
    const { macosTranslucency } = VencordSettings.store;

    if (macosTranslucency) {
        options.vibrancy = "sidebar";
        options.backgroundColor = "#ffffff00";
    } else {
        if (splashTheming) {
            options.backgroundColor = splashBackground;
        } else {
            options.backgroundColor = nativeTheme.shouldUseDarkColors ? "#313338" : "#ffffff";
        }
    }

    return options;
}

function initWindowBoundsListeners(win: BrowserWindow) {
    const saveState = () => {
        Settings.store.maximized = win.isMaximized();
        Settings.store.minimized = win.isMinimized();
    };

    win.on("maximize", saveState);
    win.on("minimize", saveState);
    win.on("unmaximize", saveState);

    const saveBounds = () => {
        Settings.store.windowBounds = win.getBounds();
    };

    win.on("resize", saveBounds);
    win.on("move", saveBounds);
}

function initSettingsListeners(win: BrowserWindow) {
    addSettingsListener("tray", enable => {
        if (enable) initTray(win);
        else tray?.destroy();
    });
    addSettingsListener("disableMinSize", disable => {
        if (disable) {
            // 0 no work
            win.setMinimumSize(1, 1);
        } else {
            win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);

            const { width, height } = win.getBounds();
            win.setBounds({
                width: Math.max(width, MIN_WIDTH),
                height: Math.max(height, MIN_HEIGHT)
            });
        }
    });

    addVencordSettingsListener("macosTranslucency", enabled => {
        if (enabled) {
            win.setVibrancy("sidebar");
            win.setBackgroundColor("#ffffff00");
        } else {
            win.setVibrancy(null);
            win.setBackgroundColor("#ffffff");
        }
    });

    addSettingsListener("enableMenu", enabled => {
        win.setAutoHideMenuBar(enabled ?? false);
    });
}

function initSpellCheck(win: BrowserWindow) {
    win.webContents.on("context-menu", (_, data) => {
        win.webContents.send(IpcEvents.SPELLCHECK_RESULT, data.misspelledWord, data.dictionarySuggestions);
    });
}

function createMainWindow() {
    // Clear up previous settings listeners
    removeSettingsListeners();
    removeVencordSettingsListeners();

    const { staticTitle, transparencyOption, enableMenu, discordWindowsTitleBar } = Settings.store;

    const { frameless } = VencordSettings.store;

    const noFrame = frameless === true || (process.platform === "win32" && discordWindowsTitleBar === true);

    const win = (mainWin = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js"),
            spellcheck: true
        },
        icon: ICON_PATH,
        frame: !noFrame,
        ...(transparencyOption &&
            transparencyOption !== "none" && {
                backgroundColor: "#00000000",
                backgroundMaterial: transparencyOption
            }),
        // Fix transparencyOption for custom discord titlebar
        
        ...(discordWindowsTitleBar && transparencyOption &&
            transparencyOption !== "none" && {
                transparent: true
            }),
        ...(staticTitle && { title: "Vesktop" }),
        ...(process.platform === "darwin" && getDarwinOptions()),
        ...getWindowBoundsOptions(),
        autoHideMenuBar: enableMenu
    }));
    win.setMenuBarVisibility(false);

    win.on("close", e => {
        const useTray = !isDeckGameMode && Settings.store.minimizeToTray !== false && Settings.store.tray !== false;
        if (isQuitting || (process.platform !== "darwin" && !useTray)) return;

        e.preventDefault();

        if (process.platform === "darwin") app.hide();
        else win.hide();

        return false;
    });

    if (Settings.store.staticTitle) win.on("page-title-updated", e => e.preventDefault());

    initWindowBoundsListeners(win);
    if (!isDeckGameMode && (Settings.store.tray ?? true) && process.platform !== "darwin") initTray(win);
    initMenuBar(win);
    makeLinksOpenExternally(win);
    initSettingsListeners(win);
    initSpellCheck(win);

    win.webContents.setUserAgent(UserAgent);

    const subdomain =
        Settings.store.discordBranch === "canary" || Settings.store.discordBranch === "ptb"
            ? `${Settings.store.discordBranch}.`
            : "";

    win.loadURL(`https://${subdomain}discord.com/app`);

    return win;
}

const runVencordMain = once(() => require(join(VENCORD_FILES_DIR, "vencordDesktopMain.js")));

export async function createWindows() {
    const splash = createSplashWindow();
    // SteamOS letterboxes and scales it terribly, so just full screen it
    if (isDeckGameMode) splash.setFullScreen(true);
    await ensureVencordFiles();
    runVencordMain();

    mainWin = createMainWindow();

    mainWin.webContents.on("did-finish-load", () => {
        splash.destroy();
        mainWin!.show();

        if (Settings.store.maximized && !isDeckGameMode) {
            mainWin!.maximize();
        }

        if (isDeckGameMode) {
            // always use entire display
            mainWin!.setFullScreen(true);

            askToApplySteamLayout(mainWin);
        }
    });

    initArRPC();
}
