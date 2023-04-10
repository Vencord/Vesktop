/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { githubGet, ReleaseData } from "main/utils/vencordLoader";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

let latestVersion: string;

ipcMain.handle(IpcEvents.UPDATER_GET_LATEST_VERSION, () => latestVersion);

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
    if (IS_DEV) return;

    try {
        const raw = await githubGet("/repos/Vencord/Desktop/releases/latest");
        const { tag_name } = JSON.parse(raw.toString("utf-8")) as ReleaseData;

        const oldVersion = app.getVersion();
        const newVersion = (latestVersion = tag_name.replace(/^v/, ""));
        if (isOutdated(oldVersion, newVersion)) openNewUpdateWindow();
    } catch (e) {
        console.error("AppUpdater: Failed to check for updates\n", e);
    }
}

function openNewUpdateWindow() {
    const win = new BrowserWindow({
        webPreferences: {
            preload: join(__dirname, "updaterPreload.js")
        }
    });

    win.loadFile(join(STATIC_DIR, "updater.html"));
}
