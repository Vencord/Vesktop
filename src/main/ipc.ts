import { app, ipcMain, shell } from "electron";
import { readFileSync, watch } from "fs";
import { open, readFile } from "fs/promises";
import { join } from "path";
import { debounce } from "shared/utils/debounce";
import { FOCUS, GET_RENDERER_SCRIPT, GET_RENDERER_STYLES, GET_SETTINGS, GET_VENCORD_PRELOAD_FILE, RELAUNCH, SET_SETTINGS, SHOW_ITEM_IN_FOLDER } from "../shared/IpcEvents";
import { VENCORD_FILES_DIR, VENCORD_QUICKCSS_FILE } from "./constants";
import { mainWin } from "./mainWindow";
import { PlainSettings, setSettings } from "./settings";

ipcMain.on(GET_VENCORD_PRELOAD_FILE, e => {
    e.returnValue = join(VENCORD_FILES_DIR, "preload.js");
});

ipcMain.on(GET_RENDERER_SCRIPT, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf-8");
});

ipcMain.handle(GET_RENDERER_STYLES, () => readFile(join(__dirname, "renderer.css"), "utf-8"));

ipcMain.on(GET_SETTINGS, e => {
    e.returnValue = PlainSettings;
});

ipcMain.handle(SET_SETTINGS, (_, settings) => {
    setSettings(settings);
});

ipcMain.handle(RELAUNCH, () => {
    app.relaunch();
    app.exit();
});

ipcMain.handle(SHOW_ITEM_IN_FOLDER, (_, path) => {
    shell.showItemInFolder(path);
});

ipcMain.handle(FOCUS, () => {
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
