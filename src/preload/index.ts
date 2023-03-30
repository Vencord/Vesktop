import { ipcRenderer, webFrame } from "electron";
import { GET_VENCORD } from "../shared/IpcEvents";

const { js, css } = ipcRenderer.sendSync(GET_VENCORD);

webFrame.executeJavaScript(js);

const style = document.createElement("style");
style.id = "vencord-css-core";
style.textContent = css;

if (document.readyState === "complete") {
    document.documentElement.appendChild(style);
} else {
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(style), {
        once: true
    });
}
