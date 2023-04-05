import { contextBridge, ipcRenderer, webFrame } from "electron";
import { GET_RENDERER_SCRIPT, GET_RENDERER_STYLES, GET_VENCORD_PRELOAD_FILE } from "../shared/IpcEvents";
import { VencordDesktop } from "./VencordDesktop";

contextBridge.exposeInMainWorld("VencordDesktop", VencordDesktop);

require(ipcRenderer.sendSync(GET_VENCORD_PRELOAD_FILE));

webFrame.executeJavaScript(ipcRenderer.sendSync(GET_RENDERER_SCRIPT));
ipcRenderer.invoke(GET_RENDERER_STYLES).then(s => webFrame.insertCSS(s));
