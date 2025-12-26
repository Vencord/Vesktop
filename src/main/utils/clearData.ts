/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, dialog } from "electron";
import { rm } from "fs/promises";
import { DATA_DIR, MessageBoxChoice } from "main/constants";

export async function clearData(win: BrowserWindow) {
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
