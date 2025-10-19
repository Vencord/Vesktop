/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { VIEW_DIR } from "shared/paths";
import { Millis } from "shared/utils/millis";

import { State } from "./settings";
import { handle } from "./utils/ipcWrappers";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";

let updaterWindow: BrowserWindow | null = null;

autoUpdater.on("update-available", update => {
    if (State.store.updater?.ignoredVersion === update.version) return;
    if ((State.store.updater?.snoozeUntil ?? 0) > Date.now()) return;

    updaterWindow = new BrowserWindow({
        title: "Vesktop Updater",
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "updaterPreload.js")
        },
        minHeight: 400,
        minWidth: 750
    });
    makeLinksOpenExternally(updaterWindow);

    handle(IpcEvents.UPDATER_GET_DATA, () => ({ update, version: app.getVersion() }));
    handle(IpcEvents.UPDATER_INSTALL, async () => {
        await autoUpdater.downloadUpdate();
    });
    handle(IpcEvents.UPDATER_SNOOZE_UPDATE, () => {
        State.store.updater ??= {};
        State.store.updater.snoozeUntil = Date.now() + 1 * Millis.DAY;
        updaterWindow?.close();
    });
    handle(IpcEvents.UPDATER_IGNORE_UPDATE, () => {
        State.store.updater ??= {};
        State.store.updater.ignoredVersion = update.version;
        updaterWindow?.close();
    });

    updaterWindow.on("closed", () => {
        ipcMain.removeHandler(IpcEvents.UPDATER_GET_DATA);
        ipcMain.removeHandler(IpcEvents.UPDATER_INSTALL);
        ipcMain.removeHandler(IpcEvents.UPDATER_SNOOZE_UPDATE);
        ipcMain.removeHandler(IpcEvents.UPDATER_IGNORE_UPDATE);
        updaterWindow = null;
    });

    updaterWindow.loadFile(join(VIEW_DIR, "updater.html"));
});

autoUpdater.on("update-downloaded", () => setTimeout(() => autoUpdater.quitAndInstall(), 100));
autoUpdater.on("download-progress", p =>
    updaterWindow?.webContents.send(IpcEvents.UPDATER_DOWNLOAD_PROGRESS, p.percent)
);
autoUpdater.on("error", err => updaterWindow?.webContents.send(IpcEvents.UPDATER_ERROR, err.message));

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.fullChangelog = true;

autoUpdater.checkForUpdates();
