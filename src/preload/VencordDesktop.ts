import { ipcRenderer } from "electron";
import type { Settings } from "../main/settings";
import { GET_SETTINGS, RELAUNCH, SET_SETTINGS, SHOW_IN_FOLDER } from "../shared/IpcEvents";

export const VencordDesktop = {
    app: {
        relaunch: () => ipcRenderer.invoke(RELAUNCH)
    },
    files: {
        showInFolder: (path: string) => ipcRenderer.invoke(SHOW_IN_FOLDER, path)
    },
    settings: {
        get: () => ipcRenderer.sendSync(GET_SETTINGS),
        set: (settings: typeof Settings) => ipcRenderer.invoke(SET_SETTINGS, settings)
    }
}

