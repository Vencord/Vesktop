import { ipcRenderer } from "electron";
import { RELAUNCH } from "../shared/IpcEvents";

export const VencordDesktop = {
    app: {
        relaunch: () => ipcRenderer.invoke(RELAUNCH)
    }
}

