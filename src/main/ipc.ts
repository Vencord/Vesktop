import { app, ipcMain, shell } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import { FOCUS, GET_RENDERER_SCRIPT, GET_SETTINGS, GET_VENCORD_PRELOAD_FILE, RELAUNCH, SET_SETTINGS, SHOW_ITEM_IN_FOLDER } from "../shared/IpcEvents";
import { VENCORD_FILES_DIR } from "./constants";
import { mainWin } from "./mainWindow";
import { PlainSettings, setSettings } from "./settings";

ipcMain.on(GET_VENCORD_PRELOAD_FILE, e => {
    e.returnValue = join(VENCORD_FILES_DIR, "preload.js");
});

ipcMain.on(GET_RENDERER_SCRIPT, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf-8");
});

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
