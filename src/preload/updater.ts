/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron";
import type { UpdateInfo } from "electron-updater";
import { IpcEvents } from "shared/IpcEvents";

import { invoke } from "./typedIpc";

contextBridge.exposeInMainWorld("VesktopUpdaterNative", {
    getData: () => invoke<UpdateInfo>(IpcEvents.UPDATER_GET_DATA),
    installUpdate: () => invoke(IpcEvents.UPDATER_INSTALL),
    onProgress: (cb: (percent: number) => void) => {
        ipcRenderer.on(IpcEvents.UPDATER_DOWNLOAD_PROGRESS, (_, percent: number) => cb(percent));
    },
    onError: (cb: (message: string) => void) => {
        ipcRenderer.on(IpcEvents.UPDATER_ERROR, (_, message: string) => cb(message));
    },
    snoozeUpdate: () => invoke(IpcEvents.UPDATER_SNOOZE_UPDATE),
    ignoreUpdate: () => invoke(IpcEvents.UPDATER_IGNORE_UPDATE)
});
