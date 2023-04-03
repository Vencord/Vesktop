import { app, ipcMain } from "electron";
import { join } from "path";
import { GET_PRELOAD_FILE, RELAUNCH } from "../shared/IpcEvents";
import { VENCORD_FILES_DIR } from "./constants";

ipcMain.on(GET_PRELOAD_FILE, e => {
    e.returnValue = join(VENCORD_FILES_DIR, "preload.js");
});

ipcMain.handle(RELAUNCH, () => {
    app.relaunch();
    app.exit();
});
