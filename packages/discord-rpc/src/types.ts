/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const RPC_VERSION = 1;

export const enum CloseCode {
    Normal = 1000,
    Unsupported = 1003,
    Abnormal = 1006,
    InvalidVersion = 4004,
    InvalidEncoding = 4005
}

export interface RpcClient {
    id: string;
    transport: "ipc" | "ws";
    clientId: string | null;
    // null for ipc. Browsers always send one, other websocket clients get ""
    origin: string | null;
    version: number;
}

export interface RpcHandlers {
    onConnect(client: RpcClient): void;
    onRequest(id: string, payload: unknown): void;
    onDisconnect(id: string): void;
}

export interface RpcConnection {
    send(json: string): void;
    close(code: number, message?: string): void;
}

export interface TransportHost {
    connect(client: Omit<RpcClient, "id">, connection: RpcConnection): string;
    request(id: string, payload: unknown): void;
    disconnect(id: string): void;
}
