import { contextBridge, ipcRenderer, webFrame } from "electron";
import { IpcEvents } from "../shared/IpcEvents";
import { VencordDesktopNative } from "./VencordDesktopNative";

contextBridge.exposeInMainWorld("VencordDesktopNative", VencordDesktopNative);

require(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_FILE));

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_RENDERER_SCRIPT));
ipcRenderer.invoke(IpcEvents.GET_RENDERER_STYLES).then(s => webFrame.insertCSS(s));
