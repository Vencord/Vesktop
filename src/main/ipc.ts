/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

if (process.platform === "linux") import("./virtmic");

import { execFile } from "child_process";
import { app, BrowserWindow, dialog, RelaunchOptions, session, shell } from "electron";
import { mkdirSync, readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { release } from "os";
import { join } from "path";
import { debounce } from "shared/utils/debounce";

import { IpcEvents } from "../shared/IpcEvents";
import { autoStart } from "./autoStart";
import { VENCORD_FILES_DIR, VENCORD_QUICKCSS_FILE, VENCORD_THEMES_DIR } from "./constants";
import { globals } from "./mainWindow";
// !!IMPORTANT!! ./appBadge import must occur after ./mainWindow
import { setBadgeCount } from "./appBadge";
import { Settings } from "./settings";
import { handle, handleSync } from "./utils/ipcWrappers";
import { isValidVencordInstall } from "./utils/vencordLoader";

handleSync(IpcEvents.GET_VENCORD_PRELOAD_FILE, () => join(VENCORD_FILES_DIR, "vencordDesktopPreload.js"));
handleSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT, () =>
    readFileSync(join(VENCORD_FILES_DIR, "vencordDesktopRenderer.js"), "utf-8")
);

handleSync(IpcEvents.GET_RENDERER_SCRIPT, () => readFileSync(join(__dirname, "renderer.js"), "utf-8"));
handleSync(IpcEvents.GET_RENDERER_CSS_FILE, () => join(__dirname, "renderer.css"));

handleSync(IpcEvents.GET_SETTINGS, () => Settings.plain);
handleSync(IpcEvents.GET_VERSION, () => app.getVersion());

handleSync(
    IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY,
    () => process.platform === "win32" && Number(release().split(".").pop()) >= 22621
);

handleSync(IpcEvents.AUTOSTART_ENABLED, () => autoStart.isEnabled());
handle(IpcEvents.ENABLE_AUTOSTART, autoStart.enable);
handle(IpcEvents.DISABLE_AUTOSTART, autoStart.disable);

handle(IpcEvents.SET_SETTINGS, (_, settings: typeof Settings.store, path?: string) => {
    Settings.setData(settings, path);
});

handle(IpcEvents.RELAUNCH, () => {
    const options: RelaunchOptions = {
        args: process.argv.slice(1).concat(["--relaunch"])
    };
    if (app.isPackaged && process.env.APPIMAGE) {
        execFile(process.env.APPIMAGE, options.args);
    } else {
        app.relaunch(options);
    }
    app.exit();
});

handle(IpcEvents.SHOW_ITEM_IN_FOLDER, (_, path) => {
    shell.showItemInFolder(path);
});

handle(IpcEvents.FOCUS, () => {
    const mainWin = globals.mainWin!;

    if (process.platform === "win32") mainWin.minimize(); // Windows is weird

    mainWin.restore();
    mainWin.show();
});

handle(IpcEvents.CLOSE, e => {
    (BrowserWindow.fromWebContents(e.sender) ?? e.sender).close();
});

handle(IpcEvents.MINIMIZE, e => {
    globals.mainWin!.minimize();
});

handle(IpcEvents.MAXIMIZE, e => {
    if (globals.mainWin!.isMaximized()) {
        globals.mainWin!.unmaximize();
    } else {
        globals.mainWin!.maximize();
    }
});

handle(IpcEvents.SPELLCHECK_SET_LANGUAGES, (_, languages: string[]) => {
    const ses = session.defaultSession;

    const available = ses.availableSpellCheckerLanguages;
    const applicable = languages.filter(l => available.includes(l)).slice(0, 3);
    if (applicable.length) ses.setSpellCheckerLanguages(applicable);
});

handle(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, (e, word: string) => {
    e.sender.replaceMisspelling(word);
});

handle(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, (e, word: string) => {
    e.sender.session.addWordToSpellCheckerDictionary(word);
});

handle(IpcEvents.SELECT_VENCORD_DIR, async () => {
    const res = await dialog.showOpenDialog(globals.mainWin!, {
        properties: ["openDirectory"]
    });
    if (!res.filePaths.length) return "cancelled";

    const dir = res.filePaths[0];
    if (!isValidVencordInstall(dir)) return "invalid";

    return dir;
});

handle(IpcEvents.SET_BADGE_COUNT, (_, count: number, native: boolean, tray: boolean) =>
    setBadgeCount(count, native, tray)
);

function readCss() {
    return readFile(VENCORD_QUICKCSS_FILE, "utf-8").catch(() => "");
}

open(VENCORD_QUICKCSS_FILE, "a+").then(fd => {
    fd.close();
    watch(
        VENCORD_QUICKCSS_FILE,
        { persistent: false },
        debounce(async () => {
            globals.mainWin?.webContents.postMessage("VencordQuickCssUpdate", await readCss());
        }, 50)
    );
});

mkdirSync(VENCORD_THEMES_DIR, { recursive: true });
watch(
    VENCORD_THEMES_DIR,
    { persistent: false },
    debounce(() => {
        globals.mainWin?.webContents.postMessage("VencordThemeUpdate", void 0);
    })
);
