/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { unlinkSync } from "fs";
import { createConnection, createServer, Socket } from "net";
import { join } from "path";

import { CloseCode, RPC_VERSION, TransportHost } from "./types";

const enum Opcode {
    Handshake,
    Frame,
    Close,
    Ping,
    Pong
}

const HEADER_SIZE = 8;
const MAX_MESSAGE_SIZE = 3 * 1024 * 1024;
const MAX_BUFFER_SIZE = 5 * 1024 * 1024;
const MAX_CONNECTIONS = 100;
const HANDSHAKE_TIMEOUT = 10_000;
const PROBE_TIMEOUT = 1000;
const MAX_SOCKETS = 10;

const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
const SOCKET_PATH =
    process.platform === "win32"
        ? "\\\\?\\pipe\\discord-ipc"
        : join(XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || "/tmp", "discord-ipc");

function encodeFrame(opcode: Opcode, json: string) {
    const size = Buffer.byteLength(json);
    const frame = Buffer.alloc(HEADER_SIZE + size);
    frame.writeInt32LE(opcode, 0);
    frame.writeInt32LE(size, 4);
    frame.write(json, HEADER_SIZE);
    return frame;
}

function createFrameReader(onFrame: (opcode: Opcode, data: any) => void) {
    let buffer = Buffer.alloc(0);

    return (chunk: Buffer) => {
        if (buffer.length + chunk.length > MAX_BUFFER_SIZE) throw new Error("total buffer size exceeded");
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= HEADER_SIZE) {
            const opcode = buffer.readInt32LE(0);
            const size = buffer.readInt32LE(4);

            if (opcode < Opcode.Handshake || opcode > Opcode.Pong || size < 0) throw new Error("protocol error");
            if (size > MAX_MESSAGE_SIZE) throw new Error("message too large");
            if (buffer.length < HEADER_SIZE + size) break;

            const data = JSON.parse(buffer.toString("utf8", HEADER_SIZE, HEADER_SIZE + size));
            buffer = buffer.subarray(HEADER_SIZE + size);
            onFrame(opcode, data);
        }
    };
}

function closeSocket(socket: Socket, code: number, message = "") {
    socket.end(encodeFrame(Opcode.Close, JSON.stringify({ code, message })));
    socket.destroy();
}

function isSocketInUse(path: string) {
    return new Promise<boolean>(resolve => {
        const socket = createConnection(path);

        const finish = (inUse: boolean) => {
            clearTimeout(timeout);
            socket.destroy();
            resolve(inUse);
        };

        const timeout = setTimeout(() => finish(true), PROBE_TIMEOUT);
        const read = createFrameReader(opcode => opcode === Opcode.Pong && finish(true));

        socket.on("connect", () => socket.write(encodeFrame(Opcode.Ping, "1")));
        socket.on("data", chunk => {
            try {
                read(chunk as Buffer);
            } catch {
                finish(true);
            }
        });
        // Only a failed connect proves nobody is listening. Unlinking a live socket would break its owner
        socket.on("error", (e: NodeJS.ErrnoException) => finish(e.code !== "ENOENT" && e.code !== "ECONNREFUSED"));
    });
}

async function findAvailableSocket() {
    for (let i = 0; i < MAX_SOCKETS; i++) {
        const path = `${SOCKET_PATH}-${i}`;
        if (await isSocketInUse(path)) continue;

        if (process.platform !== "win32") {
            try {
                unlinkSync(path);
            } catch {}
        }

        return path;
    }

    throw new Error("No available ipc socket");
}

function handleConnection(socket: Socket, host: TransportHost) {
    let id: string | undefined;

    const handshakeTimeout = setTimeout(
        () => closeSocket(socket, CloseCode.Abnormal, "Handshake timeout"),
        HANDSHAKE_TIMEOUT
    );

    const onHandshake = (data: { v?: unknown; client_id?: string }) => {
        if (id != null) throw new Error("already did handshake");

        const version = Number(data.v);
        if (version !== RPC_VERSION) {
            return closeSocket(socket, CloseCode.InvalidVersion, `Invalid Version: ${data.v}`);
        }

        clearTimeout(handshakeTimeout);

        id = host.connect(
            { transport: "ipc", clientId: data.client_id ?? null, origin: null, version },
            {
                send: json => socket.write(encodeFrame(Opcode.Frame, json)),
                close: (code, message) => closeSocket(socket, code, message)
            }
        );
    };

    const read = createFrameReader((opcode, data) => {
        switch (opcode) {
            case Opcode.Handshake:
                onHandshake(data);
                break;
            case Opcode.Frame:
                if (id == null) throw new Error("did not handshake");
                host.request(id, data);
                break;
            case Opcode.Close:
                closeSocket(socket, CloseCode.Normal, "client disconnect");
                break;
            case Opcode.Ping:
                socket.write(encodeFrame(Opcode.Pong, JSON.stringify(data)));
                break;
        }
    });

    socket.on("data", chunk => {
        try {
            read(chunk as Buffer);
        } catch (e) {
            closeSocket(socket, CloseCode.Unsupported, String(e));
        }
    });

    socket.on("error", e => console.error("[RPC:IPC] Socket error:", e));
    socket.on("close", () => {
        clearTimeout(handshakeTimeout);
        if (id != null) host.disconnect(id);
    });
}

export async function startIpcTransport(host: TransportHost) {
    let connections = 0;

    const server = createServer(socket => {
        if (connections >= MAX_CONNECTIONS) return closeSocket(socket, CloseCode.Abnormal, "Server at capacity");

        connections++;
        socket.on("close", () => connections--);
        handleConnection(socket, host);
    });

    server.on("error", e => console.error("[RPC:IPC] Server error:", e));

    const path = await findAvailableSocket();
    server.listen(path, () => console.log("[RPC:IPC] Listening on", path));

    return () => server.close();
}
