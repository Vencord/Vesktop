import { contextBridge, ipcRenderer, webFrame } from "electron";
import { readFileSync, watch } from "fs";
import { IpcEvents } from "../shared/IpcEvents";
import { VencordDesktopNative } from "./VencordDesktopNative";

contextBridge.exposeInMainWorld("VencordDesktopNative", VencordDesktopNative);

require(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_FILE));

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_RENDERER_SCRIPT));

// #region css
const rendererCss = ipcRenderer.sendSync(IpcEvents.GET_RENDERER_CSS_FILE);

const style = document.createElement("style");
style.id = "vcd-css-core";
style.textContent = readFileSync(rendererCss, "utf-8");

if (document.readyState === "complete") {
    document.documentElement.appendChild(style);
} else {
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(style), {
        once: true
    });
}

if (IS_DEV) {
    // persistent means keep process running if watcher is the only thing still running
    // which we obviously don't want
    watch(rendererCss, { persistent: false }, () => {
        document.getElementById("vcd-css-core")!.textContent = readFileSync(rendererCss, "utf-8");
    });
}

// #endregion
