/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, dialog, ipcMain, session, shell } from "electron";
import { existsSync, readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { release } from "os";
import { join } from "path";
import { debounce } from "shared/utils/debounce";

import { IpcEvents } from "../shared/IpcEvents";
import { setBadgeCount } from "./appBadge";
import { autoStart } from "./autoStart";
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

ipcMain.on(IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY, e => {
    e.returnValue = process.platform === "win32" && Number(release().split(".").pop()) >= 22621;
});

ipcMain.on(IpcEvents.AUTOSTART_ENABLED, e => {
    e.returnValue = autoStart.isEnabled();
});
ipcMain.handle(IpcEvents.ENABLE_AUTOSTART, autoStart.enable);
ipcMain.handle(IpcEvents.DISABLE_AUTOSTART, autoStart.disable);

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
    if (process.platform === "win32") mainWin.minimize(); // Windows is weird

    mainWin.restore();
    mainWin.show();
});

ipcMain.handle(IpcEvents.CLOSE, e => {
    e.sender.close();
});

ipcMain.handle(IpcEvents.SPELLCHECK_SET_LANGUAGES, (_, languages: string[]) => {
    const ses = session.defaultSession;

    const available = ses.availableSpellCheckerLanguages;
    const applicable = languages.filter(l => available.includes(l)).slice(0, 3);
    if (applicable.length) ses.setSpellCheckerLanguages(applicable);
});

ipcMain.handle(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, (e, word: string) => {
    e.sender.replaceMisspelling(word);
});

ipcMain.handle(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, (e, word: string) => {
    e.sender.session.addWordToSpellCheckerDictionary(word);
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

ipcMain.handle(IpcEvents.SET_BADGE_COUNT, (_, count: number) => setBadgeCount(count));

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
