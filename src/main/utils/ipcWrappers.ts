/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, WebFrameMain } from "electron";
import { DISCORD_HOSTNAMES } from "main/constants";
import { IpcEvents } from "shared/IpcEvents";

export function validateSender(frame: WebFrameMain | null) {
    if (!frame) throw new Error("ipc: No sender frame");

    const { hostname, protocol } = new URL(frame.url);
    if (protocol === "file:") return;

    if (!DISCORD_HOSTNAMES.includes(hostname)) throw new Error("ipc: Disallowed host " + hostname);
}

export function handleSync(event: IpcEvents, cb: (e: IpcMainEvent, ...args: any[]) => any) {
    ipcMain.on(event, (e, ...args) => {
        validateSender(e.senderFrame);
        e.returnValue = cb(e, ...args);
    });
}

export function handle(event: IpcEvents, cb: (e: IpcMainInvokeEvent, ...args: any[]) => any) {
    ipcMain.handle(event, (e, ...args) => {
        validateSender(e.senderFrame);
        return cb(e, ...args);
    });
}
