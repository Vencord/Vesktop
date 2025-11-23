/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron/renderer";

import { IpcEvents } from "../shared/IpcEvents";
import { invoke } from "./typedIpc";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);

// While sandboxed, Electron "polyfills" these APIs as local variables.
// We have to pass them as arguments as they are not global
Function(
    "require",
    "Buffer",
    "process",
    "clearImmediate",
    "setImmediate",
    ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT)
)(require, Buffer, process, clearImmediate, setImmediate);

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT));

invoke<string>(IpcEvents.GET_VESKTOP_RENDERER_CSS).then(css => {
    const style = document.createElement("style");
    style.id = "vcd-css-core";
    style.textContent = css;

    if (document.readyState === "complete") {
        document.documentElement.appendChild(style);
    } else {
        document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(style), {
            once: true
        });
    }

    if (IS_DEV) {
        ipcRenderer.on(IpcEvents.VESKTOP_RENDERER_CSS_UPDATE, (e, newCss: string) => {
            style.textContent = newCss;
        });
    }
});
