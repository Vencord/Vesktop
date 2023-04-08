import { app, ipcMain, shell } from "electron";
import { readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { join } from "path";
import { debounce } from "shared/utils/debounce";
import { IpcEvents } from "../shared/IpcEvents";
import { VENCORD_FILES_DIR, VENCORD_QUICKCSS_FILE } from "./constants";
import { mainWin } from "./mainWindow";
import { PlainSettings, setSettings } from "./settings";

ipcMain.on(IpcEvents.GET_VENCORD_PRELOAD_FILE, e => {
    e.returnValue = join(VENCORD_FILES_DIR, "preload.js");
});

ipcMain.on(IpcEvents.GET_RENDERER_SCRIPT, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf-8");
});

ipcMain.handle(IpcEvents.GET_RENDERER_STYLES, () => readFile(join(__dirname, "renderer.css"), "utf-8"));

ipcMain.on(IpcEvents.GET_SETTINGS, e => {
    e.returnValue = PlainSettings;
});

ipcMain.handle(IpcEvents.SET_SETTINGS, (_, settings) => {
    setSettings(settings);
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

function readCss() {
    return readFile(VENCORD_QUICKCSS_FILE, "utf-8").catch(() => "");
}

open(VENCORD_QUICKCSS_FILE, "a+").then(fd => {
    fd.close();
    watch(VENCORD_QUICKCSS_FILE, { persistent: false }, debounce(async () => {
        mainWin?.webContents.postMessage("VencordQuickCssUpdate", await readCss());
    }, 50));
});
