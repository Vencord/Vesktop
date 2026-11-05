/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createServer, IncomingMessage, Server } from "http";

import { WebSocket, WebSocketServer } from "ws";

import { CloseCode, RPC_VERSION, TransportHost } from "./types";

const FIRST_PORT = 6463;
const LAST_PORT = 6472;
const MAX_MESSAGE_SIZE = 3 * 1024 * 1024;

function handleConnection(socket: WebSocket, request: IncomingMessage, host: TransportHost) {
    const params = new URL(request.url!, "http://localhost").searchParams;

    const encoding = params.get("encoding") ?? "json";
    if (encoding !== "json") return socket.close(CloseCode.InvalidEncoding, `Invalid Encoding: ${encoding}`);

    const version = Number(params.get("v"));
    if (version !== RPC_VERSION) return socket.close(CloseCode.InvalidVersion, `Invalid Version: ${params.get("v")}`);

    const id = host.connect(
        { transport: "ws", clientId: params.get("client_id"), origin: request.headers.origin ?? "", version },
        {
            send: json => socket.send(json),
            close(code, message) {
                try {
                    socket.close(code, message);
                } catch {
                    // ws refuses codes that can't go on the wire, like 1006
                    socket.terminate();
                }
            }
        }
    );

    socket.on("error", e => console.error("[RPC:WS] Socket error:", e));
    socket.on("close", () => host.disconnect(id));
    socket.on("message", data => {
        try {
            host.request(id, JSON.parse(data.toString()));
        } catch {
            socket.close(CloseCode.Unsupported, "Payload not json");
        }
    });
}

function tryListen(server: Server, port: number) {
    return new Promise<boolean>(resolve => {
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => resolve(true));
    });
}

export async function startWebSocketTransport(host: TransportHost) {
    for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
        const server = createServer((_, res) => res.writeHead(404).end());
        if (!(await tryListen(server, port))) continue;

        server.on("error", e => console.error("[RPC:WS] Server error:", e));

        const webSocketServer = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_SIZE });
        webSocketServer.on("connection", (socket, request) => handleConnection(socket, request, host));

        console.log("[RPC:WS] Listening on", port);

        return () => {
            webSocketServer.close();
            server.close();
        };
    }

    console.error("[RPC:WS] No available port");
}
