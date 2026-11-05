/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { startIpcTransport } from "./ipc";
import { CloseCode, RpcConnection, RpcHandlers, TransportHost } from "./types";
import { startWebSocketTransport } from "./websocket";

export * from "./games";
export * from "./types";

export function createRpcServer(handlers: RpcHandlers) {
    const connections = new Map<string, RpcConnection>();
    let nextId = 0;

    const host: TransportHost = {
        connect(client, connection) {
            const id = String(nextId++);
            connections.set(id, connection);
            handlers.onConnect({ ...client, id });
            return id;
        },
        request: handlers.onRequest,
        disconnect(id) {
            connections.delete(id);
            handlers.onDisconnect(id);
        }
    };

    const transports = [
        startIpcTransport(host).catch(e => console.error("[RPC:IPC] Failed to start:", e)),
        startWebSocketTransport(host)
    ];

    const closeAll = (code: number, message: string) => {
        for (const connection of connections.values()) connection.close(code, message);
    };

    return {
        send: (id: string, json: string) => connections.get(id)?.send(json),
        close: (id: string, code: number, message?: string) => connections.get(id)?.close(code, message),
        closeAll,
        stop() {
            closeAll(CloseCode.Normal, "Server stopped");
            for (const transport of transports) transport.then(stop => stop?.());
        }
    };
}
