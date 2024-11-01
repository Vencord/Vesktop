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
    screen,
    session,
    systemPreferences,
    Tray
} from "electron";
import { rm } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { ICON_PATH } from "shared/paths";
import { isTruthy } from "shared/utils/guards";
import { once } from "shared/utils/once";
import type { SettingsStore } from "shared/utils/SettingsStore";

import { createAboutWindow } from "./about";
import { initArRPC } from "./arrpc";
import {
    BrowserUserAgent,
    DATA_DIR,
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    MessageBoxChoice,
    MIN_HEIGHT,
    MIN_WIDTH,
    VENCORD_DIR
} from "./constants";
import { initKeybinds } from "./keybinds";
import { Settings, State, VencordSettings } from "./settings";
import { addSplashLog, splash } from "./splash";
import { setTrayIcon } from "./tray";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { applyDeckKeyboardFix, askToApplySteamLayout, isDeckGameMode } from "./utils/steamOS";
import { downloadVencordAsar, ensureVencordFiles } from "./utils/vencordLoader";

let isQuitting = false;
export let tray: Tray;

applyDeckKeyboardFix();

app.on("before-quit", () => {
    isQuitting = true;
});

export let mainWin: BrowserWindow | null = null;

// ... (rest of the code remains unchanged)

const runVencordMain = once(() => require(VENCORD_DIR));

export async function createWindows() {
    const startMinimized = process.argv.includes("--start-minimized");
    // SteamOS letterboxes and scales it terribly, so just full screen it
    if (isDeckGameMode) {
        splash.setFullScreen(true);
    }

    addSplashLog();
    await ensureVencordFiles();
    runVencordMain();

    addSplashLog();

    // Check if a main window already exists
    if (mainWin && !mainWin.isDestroyed()) {
        // If it exists, focus and show it
        if (!mainWin.isVisible()) {
            mainWin.show();
        }
        mainWin.focus();
        return;
    }

    try {
        mainWin = createMainWindow();

        mainWin.webContents.on("did-finish-load", () => {
            if (!startMinimized && mainWin) {
                mainWin.show();
                if (State.store.maximized && !isDeckGameMode) mainWin.maximize();
            }

            if (isDeckGameMode && mainWin) {
                // always use entire display
                mainWin.setFullScreen(true);
                askToApplySteamLayout(mainWin);
            }

            mainWin?.once("show", () => {
                if (State.store.maximized && mainWin && !mainWin.isMaximized() && !isDeckGameMode) {
                    mainWin.maximize();
                }
            });

            if (splash) {
                setTimeout(() => {
                    splash.destroy();
                }, 100);
            }
        });

        // evil hack to fix electron 32 & 33 regression that makes devtools always light theme
        // https://github.com/electron/electron/issues/43367
        // TODO: remove once fixed
        mainWin.webContents.on("devtools-opened", () => {
            if (!nativeTheme.shouldUseDarkColors) return;

            nativeTheme.themeSource = "light";
            setTimeout(() => {
                nativeTheme.themeSource = "dark";
            }, 100);
        });

        initArRPC();
        initKeybinds();
    } catch (error) {
        console.error("Failed to create main window:", error);
        app.quit();
    }
}

export function getAccentColor(): Promise<string> {
    return Promise.resolve(`#${systemPreferences.getAccentColor?.() || ""}`);
}
