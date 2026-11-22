/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron/renderer";

import { IpcEvents } from "../shared/IpcEvents";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);

function watchDiscordStartup() {
    return new Promise<string | undefined>(resolve => {
        function recordError(message: string) {
            if (message !== "Uncaught Error: Sentry successfully disabled") {
                finish(message);
            }
        }

        function onError(event: ErrorEvent) {
            recordError(event.message);
        }

        function onUnhandledRejection(event: PromiseRejectionEvent) {
            if (event.reason instanceof Error) {
                recordError(event.reason.message);
            }
        }

        function finish(message: string | undefined) {
            window.removeEventListener("error", onError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
            resolve(message);
        }

        function onDomReady() {
            setTimeout(() => {
                const appMount = document.getElementById("app-mount");
                finish(appMount?.childElementCount === 0 ? "Discord failed to mount" : undefined);
            }, 10_000);
        }

        window.addEventListener("error", onError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", onDomReady, { once: true });
        } else {
            onDomReady();
        }
    });
}

async function loadRenderer() {
    // While sandboxed, Electron "polyfills" these APIs as local variables.
    // We have to pass them as arguments as they are not global
    Function("require", "process", ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT))(require, process);

    const vencordScript = ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT);
    const hasVencord = await webFrame.executeJavaScript(`${vencordScript}\n;window.Vencord != null`);
    if (!hasVencord) {
        throw new Error("Vencord did not initialize window.Vencord");
    }

    await webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT));
}

async function checkDiscordStartup() {
    // The watcher runs in Discord's JavaScript world so it can read the original error stack.
    const error = await webFrame.executeJavaScript(`(${watchDiscordStartup.toString()})()`).catch(error => {
        console.error("Failed to check Discord startup:", error);
    });
    if (error) {
        throw new Error(error);
    }
}

Promise.all([checkDiscordStartup(), loadRenderer()]).catch(error => {
    console.error("Failed to initialize the Vesktop renderer:", error);
    return ipcRenderer.invoke(IpcEvents.RENDERER_STARTUP_ERROR, String(error));
});
