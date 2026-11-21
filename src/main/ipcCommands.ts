/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";

import { ipcMain } from "electron";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

type Resolver = {
    resolve: (data: any) => void;
    reject: (data: any) => void;
    timeout?: ReturnType<typeof setTimeout>;
};
const resolvers = new Map<string, Resolver>();

export interface IpcMessage {
    nonce: string;
    message: string;
    data?: any;
}

export interface IpcResponse {
    nonce: string;
    ok: boolean;
    data?: any;
}

/**
 * Sends a message to the renderer process and waits for a response.
 * `data` must be serializable as it will be sent over IPC.
 *
 * You must add a handler for the message in the renderer process.
 */
export function sendRendererCommand<T = any>(message: string, data?: any, timeoutMs?: number) {
    if (mainWin.isDestroyed()) {
        console.warn("Main window is destroyed, cannot send IPC command:", message);
        return Promise.reject(new Error("Main window is destroyed"));
    }

    const nonce = randomUUID();

    const promise = new Promise<T>((resolve, reject) => {
        const timeout =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      resolvers.delete(nonce);
                      reject(new Error(`Timed out waiting for renderer command: ${message}`));
                  }, timeoutMs);
        resolvers.set(nonce, { resolve, reject, timeout });
    });

    try {
        mainWin.webContents.send(IpcEvents.IPC_COMMAND, { nonce, message, data });
    } catch (err) {
        const resolver = resolvers.get(nonce);
        if (resolver?.timeout) clearTimeout(resolver.timeout);
        resolvers.delete(nonce);
        return Promise.reject(err);
    }

    return promise;
}

ipcMain.on(IpcEvents.IPC_COMMAND, (_event, { nonce, ok, data }: IpcResponse) => {
    const resolver = resolvers.get(nonce);
    if (!resolver) return;

    if (resolver.timeout) clearTimeout(resolver.timeout);
    if (ok) {
        resolver.resolve(data);
    } else {
        resolver.reject(data);
    }

    resolvers.delete(nonce);
});
