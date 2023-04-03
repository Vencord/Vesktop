import { ipcRenderer } from "electron";
import { GET_PRELOAD_FILE } from "../shared/IpcEvents";

require(ipcRenderer.sendSync(GET_PRELOAD_FILE));
