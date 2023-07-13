/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { contextBridge } from "electron";
import { invoke } from "preload/typedIpc";
import { IpcEvents } from "shared/IpcEvents";

import type { UpdateData } from "./main";

contextBridge.exposeInMainWorld("Updater", {
    getData: () => invoke<UpdateData>(IpcEvents.UPDATER_GET_DATA),
    download: () => {
        invoke<void>(IpcEvents.UPDATER_DOWNLOAD);
        invoke<void>(IpcEvents.CLOSE);
    },
    ignore: () => invoke<void>(IpcEvents.UPDATE_IGNORE),
    close: () => invoke<void>(IpcEvents.CLOSE)
});
