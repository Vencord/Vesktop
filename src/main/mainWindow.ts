/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    app,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    Menu,
    MenuItemConstructorOptions,
    nativeTheme,
    Rectangle,
    screen,
    session
} from "electron";
import { join } from "path";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";
import { isTruthy } from "shared/utils/guards";
import { once } from "shared/utils/once";
import type { SettingsStore } from "shared/utils/SettingsStore";

import { createAboutWindow } from "./about";
import { initArRPC } from "./arrpc";
import { CommandLine } from "./cli";
import { BrowserUserAgent, DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH } from "./constants";
import { AppEvents } from "./events";
import { darwinURL } from "./index";
import { sendRendererCommand } from "./ipcCommands";
import { Settings, State, VencordSettings } from "./settings";
import { createSplashWindow, updateSplashMessage } from "./splash";
import { destroyTray, initTray } from "./tray";
import { clearData } from "./utils/clearData";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { applyDeckKeyboardFix, askToApplySteamLayout, isDeckGameMode } from "./utils/steamOS";
import { downloadVencordFiles, ensureVencordFiles } from "./utils/vencordLoader";
import { VENCORD_FILES_DIR } from "./vencordFilesDir";

let isQuitting = false;

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
                          sendRendererCommand(IpcCommands.NAVIGATE_SETTINGS);
                      }
                  },
                  {
                      type: "separator"
                  },
                  {
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

    const menuItems = [
        {
            label: "Vesktop",
            role: "appMenu",
            submenu: subMenu.filter(isTruthy)
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        isDarwin && { role: "windowMenu" }
    ] satisfies MenuItemList;

    const menu = Menu.buildFromTemplate(menuItems.filter(isTruthy));

    Menu.setApplicationMenu(menu);
}

function initWindowBoundsListeners(win: BrowserWindow) {
    const saveState = () => {
        State.store.maximized = win.isMaximized();
        State.store.minimized = win.isMinimized();
    };

    win.on("maximize", saveState);
    win.on("minimize", saveState);
    win.on("unmaximize", saveState);

    const saveBounds = () => {
        State.store.windowBounds = win.getBounds();
    };

    win.on("resize", saveBounds);
    win.on("move", saveBounds);
}

function initSettingsListeners(win: BrowserWindow) {
    addSettingsListener("tray", enable => {
        if (enable) initTray(win, q => (isQuitting = q));
        else destroyTray();
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

    addSettingsListener("spellCheckLanguages", languages => initSpellCheckLanguages(win, languages));
}

async function initSpellCheckLanguages(win: BrowserWindow, languages?: string[]) {
    languages ??= await sendRendererCommand(IpcCommands.GET_LANGUAGES);
    if (!languages) return;

    const ses = session.defaultSession;

    const available = ses.availableSpellCheckerLanguages;
    const applicable = languages.filter(l => available.includes(l)).slice(0, 5);
    if (applicable.length) ses.setSpellCheckerLanguages(applicable);
}

function initSpellCheck(win: BrowserWindow) {
    win.webContents.on("context-menu", (_, data) => {
        win.webContents.send(IpcEvents.SPELLCHECK_RESULT, data.misspelledWord, data.dictionarySuggestions);
    });

    initSpellCheckLanguages(win, Settings.store.spellCheckLanguages);
}

function initDevtoolsListeners(win: BrowserWindow) {
    win.webContents.on("devtools-opened", () => {
        win.webContents.send(IpcEvents.DEVTOOLS_OPENED);
    });
    win.webContents.on("devtools-closed", () => {
        win.webContents.send(IpcEvents.DEVTOOLS_CLOSED);
    });
}

function initStaticTitle(win: BrowserWindow) {
    const listener = (e: { preventDefault: Function }) => e.preventDefault();

    if (Settings.store.staticTitle) win.on("page-title-updated", listener);

    addSettingsListener("staticTitle", enabled => {
        if (enabled) {
            win.setTitle("Vesktop");
            win.on("page-title-updated", listener);
        } else {
            win.off("page-title-updated", listener);
        }
    });
}

function getWindowBoundsOptions(): BrowserWindowConstructorOptions {
    // We want the default window behaviour to apply in game mode since it expects everything to be fullscreen and maximized.
    if (isDeckGameMode) return {};

    const { x, y, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = State.store.windowBounds ?? {};

    const options = { width, height } as BrowserWindowConstructorOptions;

    if (x != null && y != null) {
        function isInBounds(rect: Rectangle, display: Rectangle) {
            return !(
                rect.x + rect.width < display.x ||
                rect.x > display.x + display.width ||
                rect.y + rect.height < display.y ||
                rect.y > display.y + display.height
            );
        }

        const inBounds = screen.getAllDisplays().some(d => isInBounds({ x, y, width, height }, d.bounds));
        if (inBounds) {
            options.x = x;
            options.y = y;
        }
    }

    if (!Settings.store.disableMinSize) {
        options.minWidth = MIN_WIDTH;
        options.minHeight = MIN_HEIGHT;
    }

    return options;
}

function buildBrowserWindowOptions(): BrowserWindowConstructorOptions {
    const { staticTitle, transparencyOption, enableMenu, customTitleBar, splashTheming, splashBackground } =
        Settings.store;

    const { frameless, transparent, macosTranslucency } = VencordSettings.store;

    const noFrame = frameless === true || customTitleBar === true;
    const backgroundColor =
        splashTheming !== false ? splashBackground : nativeTheme.shouldUseDarkColors ? "#313338" : "#ffffff";

    const options: BrowserWindowConstructorOptions = {
        show: Settings.store.enableSplashScreen === false && !CommandLine.values["start-minimized"],
        backgroundColor,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false, // TODO
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js"),
            spellcheck: true,
            // disable renderer backgrounding to prevent the app from unloading when in the background
            backgroundThrottling: false
        },
        frame: !noFrame,
        autoHideMenuBar: enableMenu,
        ...getWindowBoundsOptions()
    };

    if (transparent) {
        options.transparent = true;
        options.backgroundColor = "#00000000";
    }

    if (transparencyOption && transparencyOption !== "none") {
        options.backgroundColor = "#00000000";
        options.backgroundMaterial = transparencyOption;

        if (customTitleBar) {
            options.transparent = true;
        }
    }

    if (staticTitle) {
        options.title = "Vesktop";
    }

    if (process.platform === "darwin") {
        options.titleBarStyle = "hidden";
        options.trafficLightPosition = { x: 10, y: 10 };

        if (macosTranslucency) {
            options.vibrancy = "sidebar";
            options.backgroundColor = "#ffffff00";
        }
    }

    return options;
}

function createMainWindow() {
    // Clear up previous settings listeners
    removeSettingsListeners();
    removeVencordSettingsListeners();

    const win = (mainWin = new BrowserWindow(buildBrowserWindowOptions()));

    win.setMenuBarVisibility(false);
    if (process.platform === "darwin" && Settings.store.customTitleBar) win.setWindowButtonVisibility(false);

    win.on("close", e => {
        const useTray = !isDeckGameMode && Settings.store.minimizeToTray !== false && Settings.store.tray !== false;
        if (isQuitting || (process.platform !== "darwin" && !useTray)) return;

        e.preventDefault();

        if (process.platform === "darwin") app.hide();
        else win.hide();

        return false;
    });

    initWindowBoundsListeners(win);
    if (!isDeckGameMode && (Settings.store.tray ?? true) && process.platform !== "darwin")
        initTray(win, q => (isQuitting = q));

    initMenuBar(win);
    makeLinksOpenExternally(win);
    initSettingsListeners(win);
    initSpellCheck(win);
    initDevtoolsListeners(win);
    initStaticTitle(win);

    win.webContents.setUserAgent(BrowserUserAgent);

    // if the open-url event is fired (in index.ts) while starting up, darwinURL will be set. If not fall back to checking the process args (which Windows and Linux use for URI calling.)
    // win.webContents.session.clearCache().then(() => {
    loadUrl(darwinURL || process.argv.find(arg => arg.startsWith("discord://")));
    // });

    return win;
}

const runVencordMain = once(() => require(join(VENCORD_FILES_DIR, "vencordDesktopMain.js")));

export function loadUrl(uri: string | undefined) {
    const branch = Settings.store.discordBranch;
    const subdomain = branch === "canary" || branch === "ptb" ? `${branch}.` : "";

    // we do not rely on 'did-finish-load' because it fires even if loadURL fails which triggers early detruction of the splash
    mainWin
        .loadURL(`https://${subdomain}discord.com/${uri ? new URL(uri).pathname.slice(1) || "app" : "app"}`)
        .then(() => AppEvents.emit("appLoaded"))
        .catch(error => retryUrl(error.url, error.code));
}

const retryDelay = 1000;
function retryUrl(url: string, description: string) {
    console.log(`retrying in ${retryDelay}ms`);
    updateSplashMessage(`Failed to load Discord: ${description}`);
    setTimeout(() => loadUrl(url), retryDelay);
}

export async function createWindows() {
    const startMinimized = CommandLine.values["start-minimized"];

    let splash: BrowserWindow | undefined;
    if (Settings.store.enableSplashScreen !== false) {
        splash = createSplashWindow(startMinimized);

        // SteamOS letterboxes and scales it terribly, so just full screen it
        if (isDeckGameMode) splash.setFullScreen(true);
    }

    await ensureVencordFiles();
    runVencordMain();

    mainWin = createMainWindow();

    AppEvents.on("appLoaded", () => {
        splash?.destroy();

        if (!startMinimized) {
            if (splash) mainWin!.show();
            if (State.store.maximized && !isDeckGameMode) mainWin!.maximize();
        }

        if (isDeckGameMode) {
            // always use entire display
            mainWin!.setFullScreen(true);

            askToApplySteamLayout(mainWin);
        }

        mainWin.once("show", () => {
            if (State.store.maximized && !mainWin!.isMaximized() && !isDeckGameMode) {
                mainWin!.maximize();
            }
        });
    });

    mainWin.webContents.on("did-navigate", (_, url: string, responseCode: number) => {
        updateSplashMessage(""); // clear the splash message

        // check url to ensure app doesn't loop
        if (responseCode >= 300 && new URL(url).pathname !== `/app`) {
            loadUrl(undefined);
            console.warn(`'did-navigate': Caught bad page response: ${responseCode}, redirecting to main app`);
        }
    });

    initArRPC();
}
