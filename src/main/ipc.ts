/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

if (process.platform === "linux") import("./venmic");

import { execFile } from "child_process";
import { app, BrowserWindow, clipboard, dialog, nativeImage, RelaunchOptions, session, shell } from "electron";
import { mkdirSync, readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { release } from "os";
import { join } from "path";
import { debounce } from "shared/utils/debounce";

import { IpcEvents } from "../shared/IpcEvents";
import { setBadgeCount } from "./appBadge";
import { autoStart } from "./autoStart";
import { VENCORD_FILES_DIR, VENCORD_QUICKCSS_FILE, VENCORD_THEMES_DIR } from "./constants";
import { mainWin } from "./mainWindow";
import { Settings } from "./settings";
import { handle, handleSync } from "./utils/ipcWrappers";
import { PopoutWindows } from "./utils/popout";
import { isDeckGameMode, showGamePage } from "./utils/steamOS";
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

handle(IpcEvents.RELAUNCH, async () => {
    const options: RelaunchOptions = {
        args: process.argv.slice(1).concat(["--relaunch"])
    };
    if (isDeckGameMode) {
        // We can't properly relaunch when running under gamescope, but we can at least navigate to our page in Steam.
        await showGamePage();
    } else if (app.isPackaged && process.env.APPIMAGE) {
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
    mainWin.show();
    mainWin.setSkipTaskbar(false);
});

handle(IpcEvents.CLOSE, (e, key?: string) => {
    const popout = PopoutWindows.get(key!);
    if (popout) return popout.close();

    const win = BrowserWindow.fromWebContents(e.sender) ?? e.sender;
    win.close();
});

handle(IpcEvents.MINIMIZE, e => {
    mainWin.minimize();
});

handle(IpcEvents.MAXIMIZE, e => {
    if (mainWin.isMaximized()) {
        mainWin.unmaximize();
    } else {
        mainWin.maximize();
    }
});

handleSync(IpcEvents.SPELLCHECK_GET_AVAILABLE_LANGUAGES, e => {
    e.returnValue = session.defaultSession.availableSpellCheckerLanguages;
});

handle(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, (e, word: string) => {
    e.sender.replaceMisspelling(word);
});

handle(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, (e, word: string) => {
    e.sender.session.addWordToSpellCheckerDictionary(word);
});

handle(IpcEvents.SELECT_VENCORD_DIR, async () => {
    const res = await dialog.showOpenDialog(mainWin!, {
        properties: ["openDirectory"]
    });
    if (!res.filePaths.length) return "cancelled";

    const dir = res.filePaths[0];
    if (!isValidVencordInstall(dir)) return "invalid";

    return dir;
});

handle(IpcEvents.SET_BADGE_COUNT, (_, count: number) => setBadgeCount(count));

handle(IpcEvents.CLIPBOARD_COPY_IMAGE, async (_, buf: ArrayBuffer, src: string) => {
    clipboard.write({
        html: `<img src="${src.replaceAll('"', '\\"')}">`,
        image: nativeImage.createFromBuffer(Buffer.from(buf))
    });
});

const registered_keybinds = {};

handle(IpcEvents.KEYBIND_REGISTER, (_, id: number, shortcut: string, options: any) => {
    registered_keybinds[id] = shortcut;
});
handle(IpcEvents.KEYBIND_UNREGISTER, (_, id: number) => {
    delete registered_keybinds[id];
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

mkdirSync(VENCORD_THEMES_DIR, { recursive: true });
watch(
    VENCORD_THEMES_DIR,
    { persistent: false },
    debounce(() => {
        mainWin?.webContents.postMessage("VencordThemeUpdate", void 0);
    })
);
