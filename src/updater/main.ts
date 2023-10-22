/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, BrowserWindow, shell } from "electron";
import { Settings } from "main/settings";
import { patchVencordView } from "main/splash";
import { handle } from "main/utils/ipcWrappers";
import { makeLinksOpenExternally } from "main/utils/makeLinksOpenExternally";
import { githubGet, ReleaseData } from "main/utils/vencordLoader";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { ICON_PATH, VIEW_DIR } from "shared/paths";

export interface UpdateData {
    currentVersion: string;
    latestVersion: string;
    release: ReleaseData;
}

let updateData: UpdateData;

handle(IpcEvents.UPDATER_GET_DATA, () => updateData);
handle(IpcEvents.UPDATER_DOWNLOAD, () => {
    const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;

    const { assets } = updateData.release;
    const url = (() => {
        switch (process.platform) {
            case "win32":
                return assets.find(a => {
                    if (!a.name.endsWith(".exe")) return false;

                    const isSetup = a.name.includes("Setup");
                    return portable ? !isSetup : isSetup;
                })!.browser_download_url;
            case "darwin":
                return assets.find(a =>
                    process.arch === "arm64"
                        ? a.name.endsWith("-arm64-mac.zip")
                        : a.name.endsWith("-mac.zip") && !a.name.includes("arm64")
                )!.browser_download_url;
            case "linux":
                return updateData.release.html_url;
            default:
                throw new Error(`Unsupported platform: ${process.platform}`);
        }
    })();

    shell.openExternal(url);
});

handle(IpcEvents.UPDATE_IGNORE, () => {
    Settings.store.skippedUpdate = updateData.latestVersion;
});

function isOutdated(oldVersion: string, newVersion: string) {
    const oldParts = oldVersion.split(".");
    const newParts = newVersion.split(".");

    if (oldParts.length !== newParts.length)
        throw new Error(`Incompatible version strings (old: ${oldVersion}, new: ${newVersion})`);

    for (let i = 0; i < oldParts.length; i++) {
        const oldPart = Number(oldParts[i]);
        const newPart = Number(newParts[i]);

        if (isNaN(oldPart) || isNaN(newPart))
            throw new Error(`Invalid version string (old: ${oldVersion}, new: ${newVersion})`);

        if (oldPart < newPart) return true;
        if (oldPart > newPart) return false;
    }

    return false;
}

export async function checkUpdates() {
    // if (IS_DEV) return;
    try {
        const raw = await githubGet("/repos/Vencord/Vesktop/releases/latest");
        const data = JSON.parse(raw.toString("utf-8")) as ReleaseData;

        const oldVersion = app.getVersion();
        const newVersion = data.tag_name.replace(/^v/, "");
        updateData = {
            currentVersion: oldVersion,
            latestVersion: newVersion,
            release: data
        };

        if (Settings.store.skippedUpdate !== newVersion && isOutdated(oldVersion, newVersion)) {
            openNewUpdateWindow();
        }
    } catch (e) {
        console.error("AppUpdater: Failed to check for updates\n", e);
    }
}

function openNewUpdateWindow() {
    const win = new BrowserWindow({
        width: 500,
        autoHideMenuBar: true,
        alwaysOnTop: true,
        webPreferences: {
            preload: join(__dirname, "updaterPreload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        },
        ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
        icon: ICON_PATH
    });

    makeLinksOpenExternally(win);
    patchVencordView(win);

    win.loadFile(join(VIEW_DIR, "updater.html"));
}
