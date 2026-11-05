/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { CloseCode, createRpcServer, startGameDetection } from "discord-rpc";
import { SESSION_DATA_DIR } from "main/constants";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";
import { handle } from "../utils/ipcWrappers";

let server: ReturnType<typeof createRpcServer> | null = null;
let gameDetection: ReturnType<typeof startGameDetection> | null = null;
let rendererReady = false;

function sendToRenderer(id: string, command: IpcCommands, data: unknown) {
    sendRendererCommand(command, data).catch(() => server?.close(id, CloseCode.Abnormal, "Renderer unavailable"));
}

function sendGame(game: unknown, running: boolean) {
    sendRendererCommand(IpcCommands.RPC_GAME, { game, running }).catch(() => {});
}

function start() {
    server = createRpcServer({
        onConnect: client => sendToRenderer(client.id, IpcCommands.RPC_CONNECT, client),
        // Sent as json since objects from the bridge can't be relied on to be mutable, which Discord's handlers expect
        onRequest: (id, payload) =>
            sendToRenderer(id, IpcCommands.RPC_REQUEST, { id, payload: JSON.stringify(payload) }),
        onDisconnect: id => sendRendererCommand(IpcCommands.RPC_DISCONNECT, id).catch(() => {})
    });

    gameDetection = startGameDetection({
        nativePath: join(STATIC_DIR, `dist/game-detection-${process.arch}.node`),
        cachePath: join(SESSION_DATA_DIR, "arrpc-detectable-db.json"),
        onChange: sendGame
    });
}

function stop() {
    if (!server) return;

    server.stop();
    gameDetection!.stop();
    server = gameDetection = null;

    sendRendererCommand(IpcCommands.RPC_RESET).catch(() => {});
}

handle(IpcEvents.RPC_READY, () => {
    rendererReady = true;

    if (server) {
        server.closeAll(CloseCode.Normal, "Renderer reloaded");
        gameDetection!.getGames().forEach(game => sendGame(game, true));
    } else if (Settings.store.arRPC) {
        start();
    }
});

handle(IpcEvents.RPC_SEND, (_, id: string, json: string) => server?.send(id, json));
handle(IpcEvents.RPC_CLOSE, (_, id: string, code: number, message?: string) => server?.close(id, code, message));

Settings.addChangeListener("arRPC", enabled => {
    if (!enabled) stop();
    else if (rendererReady && !server) start();
});
