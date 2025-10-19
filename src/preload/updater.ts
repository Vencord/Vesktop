/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron";
import type { UpdateInfo } from "electron-updater";
import { UpdaterIpcEvents } from "shared/IpcEvents";

import { invoke } from "./typedIpc";

contextBridge.exposeInMainWorld("VesktopUpdaterNative", {
    getData: () => invoke<UpdateInfo>(UpdaterIpcEvents.GET_DATA),
    installUpdate: () => invoke(UpdaterIpcEvents.INSTALL),
    onProgress: (cb: (percent: number) => void) => {
        ipcRenderer.on(UpdaterIpcEvents.DOWNLOAD_PROGRESS, (_, percent: number) => cb(percent));
    },
    onError: (cb: (message: string) => void) => {
        ipcRenderer.on(UpdaterIpcEvents.ERROR, (_, message: string) => cb(message));
    },
    snoozeUpdate: () => invoke(UpdaterIpcEvents.SNOOZE_UPDATE),
    ignoreUpdate: () => invoke(UpdaterIpcEvents.IGNORE_UPDATE)
});
