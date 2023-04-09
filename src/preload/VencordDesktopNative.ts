import { ipcRenderer } from "electron";
import type { Settings } from "shared/settings";
import type { LiteralUnion } from "type-fest";
import { IpcEvents } from "../shared/IpcEvents";

function invoke<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.invoke(event, ...args) as Promise<T>;
}

function sendSync<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.sendSync(event, ...args) as T;
}

export const VencordDesktopNative = {
    app: {
        relaunch: () => invoke<void>(IpcEvents.RELAUNCH),
        getVersion: () => sendSync<void>(IpcEvents.GET_VERSION)
    },
    fileManager: {
        showItemInFolder: (path: string) => invoke<void>(IpcEvents.SHOW_ITEM_IN_FOLDER, path),
        selectVencordDir: () => invoke<LiteralUnion<"cancelled" | "invalid", string>>(IpcEvents.SELECT_VENCORD_DIR),
    },
    settings: {
        get: () => sendSync<Settings>(IpcEvents.GET_SETTINGS),
        set: (settings: Settings) => invoke<void>(IpcEvents.SET_SETTINGS, settings)
    },
    win: {
        focus: () => invoke<void>(IpcEvents.FOCUS)
    }
}

