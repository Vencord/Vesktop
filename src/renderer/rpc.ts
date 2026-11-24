/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByCodeLazy, findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, StreamerModeStore } from "@vencord/types/webpack/common";
import type { DetectedGame, RpcClient } from "discord-rpc";
import { IpcCommands } from "shared/IpcEvents";

import { onIpcCommand } from "./ipcCommands";

type TransportEvent = "connect" | "request" | "disconnect";

interface Connection {
    socket: ReturnType<typeof createSocket>;
    // Resolves to whether Discord accepted the client. Requests have to wait for this
    ready: Promise<boolean>;
}

// Discord's own RPC server. All commands and events are registered on it even on web,
// it just doesn't have any transport for desktop clients
const RPCServer = findByPropsLazy("registerTransport", "dispatchToSubscriptions");
// Validates origin & client ID
const validateClient: (socket: unknown, origin: string | null, clientId: string | null) => Promise<void> =
    findByCodeLazy('"No Client ID Specified"');

const STREAMER_MODE_ID = "STREAMERMODE";

const listeners = {} as Record<TransportEvent, (...args: any[]) => void>;
const connections = new Map<string, Connection>();
const games = new Map<string, DetectedGame>();

let userDisabledStreamerMode = false;
let observedGamesCallback: ((games: unknown[]) => void) | undefined;

// Replaces the native process observer that feeds RunningGameStore, see patches/gameDetection.ts
export function setObservedGamesCallback(callback: typeof observedGamesCallback) {
    observedGamesCallback = callback;
    reportGames();
}

function createSocket({ id, transport, version }: RpcClient) {
    // Empty values are filled in by Discord's validateClient. Discord uses their own class with defaults for this,
    // mimic same defaults here
    return {
        id,
        version,
        encoding: "json",
        transport,
        source: { type: transport },
        application: { id: null, name: null, icon: null },
        authorization: { authing: false, scopes: new Set<string>(), accessToken: null, expires: new Date(0) },
        abortController: new AbortController(),
        send: (payload: unknown) => VesktopNative.rpc.send(id, JSON.stringify(payload)),
        close: (code: number, message?: string) => VesktopNative.rpc.close(id, code, message)
    };
}

// Discord only focuses the window for these on the desktop app
function opensUi({ cmd, args }: { cmd?: string; args?: Record<string, unknown> }) {
    switch (cmd) {
        case "AUTHORIZE":
        case "INVITE_BROWSER":
        case "GUILD_TEMPLATE_BROWSER":
        case "GIFT_CODE_BROWSER":
        case "DEEP_LINK":
            return true;
        case "AUTHENTICATE":
            return args?.access_token == null;
        default:
            return false;
    }
}

function disconnect(id: string) {
    const connection = connections.get(id);
    if (!connection) return;

    const { socket, ready } = connection;
    connections.delete(id);

    socket.abortController.abort("DISCONNECTED");
    ready.then(accepted => accepted && listeners.disconnect(socket));
}

function reportGames() {
    observedGamesCallback?.(
        Array.from(games.values(), ({ id, name, pid, path }) => {
            const exeName = path.split("/").pop();

            return {
                id,
                name,
                pid,
                exeName,
                exePath: path,
                processName: exeName,
                cmdLine: "",
                pidPath: [pid],
                isLauncher: false,
                lastFocused: Math.floor(Date.now() / 1000),
                // Otherwise Discord asks its native module for it
                windowHandle: "0"
            };
        })
    );
}

function updateStreamerMode(running: boolean) {
    if (!StreamerModeStore.autoToggle) return;

    if (!running) {
        userDisabledStreamerMode = false;
    } else if (userDisabledStreamerMode) {
        return;
    }

    FluxDispatcher.dispatch({
        type: "STREAMER_MODE_UPDATE",
        key: "enabled",
        value: running,
        isAuto: true
    });
}

onIpcCommand(IpcCommands.RPC_CONNECT, (client: RpcClient) => {
    const socket = createSocket(client);

    const ready = validateClient(socket, client.origin, client.clientId).then(
        () => {
            if (socket.abortController.signal.aborted) return false;

            listeners.connect(socket);
            return true;
        },
        ({ code, message }) => {
            if (!socket.abortController.signal.aborted) socket.close(code, message);
            return false;
        }
    );

    connections.set(client.id, { socket, ready });
});

onIpcCommand(IpcCommands.RPC_REQUEST, async ({ id, payload }: { id: string; payload: string }) => {
    const connection = connections.get(id);
    if (!connection || !(await connection.ready)) return;

    const request = JSON.parse(payload);
    if (opensUi(request)) VesktopNative.win.focus();

    listeners.request(connection.socket, request);
});

onIpcCommand(IpcCommands.RPC_DISCONNECT, disconnect);

onIpcCommand(IpcCommands.RPC_GAME, ({ game, running }: { game: DetectedGame; running: boolean }) => {
    if (game.id === STREAMER_MODE_ID) return updateStreamerMode(running);

    if (running) games.set(game.id, game);
    else games.delete(game.id);

    reportGames();
});

onIpcCommand(IpcCommands.RPC_RESET, () => {
    for (const id of connections.keys()) disconnect(id);
    games.clear();
    reportGames();
});

onceReady.then(() => {
    FluxDispatcher.subscribe("STREAMER_MODE_UPDATE", e => {
        if (!e.isAuto && !e.value) {
            userDisabledStreamerMode = true;
        }
    });

    RPCServer.registerTransport({
        on(event: TransportEvent, listener: (...args: any[]) => void) {
            listeners[event] = listener;
        }
    });

    VesktopNative.rpc.ready();
});
