import { ipcMain } from "electron";
import { GET_VENCORD } from "../shared/IpcEvents";
import { fetchVencord } from "./vencord";

ipcMain.on(GET_VENCORD, async e => {
    e.returnValue = await fetchVencord();
});
