import { ipcRenderer } from "electron";
import type { Settings } from "../main/settings";
import { FOCUS, GET_SETTINGS, RELAUNCH, SET_SETTINGS, SHOW_ITEM_IN_FOLDER } from "../shared/IpcEvents";

export const VencordDesktop = {
    app: {
        relaunch: () => ipcRenderer.invoke(RELAUNCH)
    },
    fileManager: {
        showItemInFolder: (path: string) => ipcRenderer.invoke(SHOW_ITEM_IN_FOLDER, path)
    },
    settings: {
        get: () => ipcRenderer.sendSync(GET_SETTINGS),
        set: (settings: typeof Settings) => ipcRenderer.invoke(SET_SETTINGS, settings)
    },
    win: {
        focus: () => ipcRenderer.invoke(FOCUS)
    }
}

