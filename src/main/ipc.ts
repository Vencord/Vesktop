/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, dialog, ipcMain, shell } from "electron";
import { existsSync, readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { join } from "path";
import { debounce } from "shared/utils/debounce";

import { IpcEvents } from "../shared/IpcEvents";
import { VENCORD_FILES_DIR, VENCORD_QUICKCSS_FILE } from "./constants";
import { mainWin } from "./mainWindow";
import { Settings } from "./settings";

ipcMain.on(IpcEvents.GET_VENCORD_PRELOAD_FILE, e => {
    e.returnValue = join(VENCORD_FILES_DIR, "preload.js");
});

ipcMain.on(IpcEvents.GET_VENCORD_RENDERER_SCRIPT, e => {
    e.returnValue = readFileSync(join(VENCORD_FILES_DIR, "vencordDesktopRenderer.js"), "utf-8");
});

ipcMain.on(IpcEvents.GET_RENDERER_SCRIPT, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf-8");
});

ipcMain.on(IpcEvents.GET_RENDERER_CSS_FILE, e => {
    e.returnValue = join(__dirname, "renderer.css");
});

ipcMain.on(IpcEvents.GET_SETTINGS, e => {
    e.returnValue = Settings.plain;
});

ipcMain.on(IpcEvents.GET_VERSION, e => {
    e.returnValue = app.getVersion();
});

ipcMain.handle(IpcEvents.SET_SETTINGS, (_, settings: typeof Settings.store, path?: string) => {
    Settings.setData(settings, path);
});

ipcMain.handle(IpcEvents.RELAUNCH, () => {
    app.relaunch();
    app.exit();
});

ipcMain.handle(IpcEvents.SHOW_ITEM_IN_FOLDER, (_, path) => {
    shell.showItemInFolder(path);
});

ipcMain.handle(IpcEvents.FOCUS, () => {
    mainWin?.focus();
});

ipcMain.handle(IpcEvents.SELECT_VENCORD_DIR, async () => {
    const res = await dialog.showOpenDialog(mainWin!, {
        properties: ["openDirectory"]
    });
    if (!res.filePaths.length) return "cancelled";

    const dir = res.filePaths[0];
    for (const file of ["vencordDesktopMain.js", "preload.js", "vencordDesktopRenderer.js", "renderer.css"]) {
        if (!existsSync(join(dir, file))) return "invalid";
    }

    return dir;
});

function readCss() {
    return readFile(VENCORD_QUICKCSS_FILE, "utf-8").catch(() => "");
}

open(VENCORD_QUICKCSS_FILE, "a+").then(fd => {
    fd.close();
    watch(
        VENCORD_QUICKCSS_FILE,
        { persistent: false },
        debounce(async () => {
            mainWin?.webContents.postMessage("VencordQuickCssUpdate", await readCss());
        }, 50)
    );
});
