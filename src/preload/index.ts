import { contextBridge, ipcRenderer } from "electron";
import { GET_PRELOAD_FILE } from "../shared/IpcEvents";
import { VencordDesktop } from "./VencordDesktop";

contextBridge.exposeInMainWorld("VencordDesktop", VencordDesktop);

require(ipcRenderer.sendSync(GET_PRELOAD_FILE));
