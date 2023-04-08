import { app, ipcRenderer } from "electron";
import type { Settings } from "../main/settings";
import { IpcEvents } from "../shared/IpcEvents";

export const VencordDesktopNative = {
    app: {
        relaunch: () => ipcRenderer.invoke(IpcEvents.RELAUNCH),
        getVersion: () => app.getVersion()
    },
    fileManager: {
        showItemInFolder: (path: string) => ipcRenderer.invoke(IpcEvents.SHOW_ITEM_IN_FOLDER, path)
    },
    settings: {
        get: () => ipcRenderer.sendSync(IpcEvents.GET_SETTINGS),
        set: (settings: typeof Settings) => ipcRenderer.invoke(IpcEvents.SET_SETTINGS, settings)
    },
    win: {
        focus: () => ipcRenderer.invoke(IpcEvents.FOCUS)
    }
}

