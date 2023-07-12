/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { ipcRenderer } from "electron";
import { IpcEvents } from "shared/IpcEvents";

export function invoke<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.invoke(event, ...args) as Promise<T>;
}

export function sendSync<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.sendSync(event, ...args) as T;
}
