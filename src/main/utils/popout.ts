/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { Settings } from "main/settings";

import { handleExternalUrl } from "./makeLinksOpenExternally";

const ALLOWED_FEATURES = new Set([
    "width",
    "height",
    "left",
    "top",
    "resizable",
    "movable",
    "alwaysOnTop",
    "frame",
    "transparent",
    "hasShadow",
    "closable",
    "skipTaskbar",
    "backgroundColor",
    "menubar",
    "toolbar",
    "location",
    "directories",
    "titleBarStyle"
]);

const MIN_POPOUT_WIDTH = 320;
const MIN_POPOUT_HEIGHT = 180;
const DEFAULT_POPOUT_OPTIONS: BrowserWindowConstructorOptions = {
    title: "Discord Popout",
    backgroundColor: "#2f3136",
    minWidth: MIN_POPOUT_WIDTH,
    minHeight: MIN_POPOUT_HEIGHT,
    frame: Settings.store.customTitleBar !== true,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition:
        process.platform === "darwin"
            ? {
                  x: 10,
                  y: 3
              }
            : undefined,
    webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
    },
    autoHideMenuBar: Settings.store.enableMenu
};

export const PopoutWindows = new Map<string, BrowserWindow>();

function focusWindow(window: BrowserWindow) {
    window.setAlwaysOnTop(true);
    window.focus();
    window.setAlwaysOnTop(false);
}

function parseFeatureValue(feature: string) {
    if (feature === "yes") return true;
    if (feature === "no") return false;

    const n = Number(feature);
    if (!isNaN(n)) return n;

    return feature;
}

function parseWindowFeatures(features: string) {
    const keyValuesParsed = features.split(",");

    return keyValuesParsed.reduce((features, feature) => {
        const [key, value] = feature.split("=");
        if (ALLOWED_FEATURES.has(key)) features[key] = parseFeatureValue(value);

        return features;
    }, {});
}

export function createOrFocusPopup(key: string, features: string) {
    const existingWindow = PopoutWindows.get(key);
    if (existingWindow) {
        focusWindow(existingWindow);
        return <const>{ action: "deny" };
    }

    return <const>{
        action: "allow",
        overrideBrowserWindowOptions: {
            ...DEFAULT_POPOUT_OPTIONS,
            ...parseWindowFeatures(features)
        }
    };
}

export function setupPopout(win: BrowserWindow, key: string) {
    win.setMenuBarVisibility(false);

    PopoutWindows.set(key, win);

    /* win.webContents.on("will-navigate", (evt, url) => {
        // maybe prevent if not origin match
    })*/

    win.webContents.setWindowOpenHandler(({ url }) => handleExternalUrl(url));

    win.once("closed", () => {
        win.removeAllListeners();
        PopoutWindows.delete(key);
    });
}
