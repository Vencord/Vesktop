/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ipcMain } from "electron";
import { resolve } from "path";
import { IpcCommands } from "shared/IpcEvents";
import { MessageChannel, MessagePort, Worker } from "worker_threads";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";
import { ArRpcHostEvent } from "./types";

let worker: Worker;
let hostPortRef: MessagePort | null = null;
let voiceIpcRegistered = false;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (worker || !Settings.store.arRPC) return;

    try {
        const { port1: hostPort, port2: workerPort } = new MessageChannel();
        hostPortRef = hostPort;

        worker = new Worker(resolve(__dirname, "./arRpcWorker.js"), {
            workerData: {
                workerPort
            },
            transferList: [workerPort]
        });

        hostPort.on("message", async message => {
            const { type, nonce, data } = message as any;
            switch (type) {
                case "activity": {
                    sendRendererCommand(IpcCommands.RPC_ACTIVITY, data);
                    break;
                }

                case "invite": {
                    const invite = String(data);

                    const response: ArRpcHostEvent = {
                        type: "ack-invite",
                        nonce,
                        data: false
                    };

                    if (!inviteCodeRegex.test(invite)) {
                        return hostPort.postMessage(response);
                    }

                    response.data = await sendRendererCommand(IpcCommands.RPC_INVITE, invite).catch(() => false);

                    hostPort.postMessage(response);
                    break;
                }

                case "link": {
                    const response: ArRpcHostEvent = {
                        type: "ack-link",
                        nonce: nonce,
                        data: false
                    };

                    response.data = await sendRendererCommand(IpcCommands.RPC_DEEP_LINK, data).catch(() => false);

                    hostPort.postMessage(response);
                    break;
                }

                case "voice-set": {
                    const response: ArRpcHostEvent = {
                        type: "ack-voice-set",
                        nonce,
                        data: undefined as any
                    } as any;

                    try {
                        response.data = await sendRendererCommand(IpcCommands.RPC_SET_VOICE_SETTINGS, data);
                    } catch (err: any) {
                        response.data = { error: String(err) } as any;
                    }

                    hostPort.postMessage(response);
                    break;
                }

                case "voice-get": {
                    const response: ArRpcHostEvent = {
                        type: "ack-voice-get",
                        nonce,
                        data: undefined as any
                    } as any;

                    try {
                        response.data = await sendRendererCommand(IpcCommands.RPC_GET_VOICE_SETTINGS, data);
                    } catch (err: any) {
                        response.data = { error: String(err) } as any;
                    }

                    hostPort.postMessage(response);
                    break;
                }

                case "voice-channel-get": {
                    const response: ArRpcHostEvent = {
                        type: "ack-voice-channel",
                        nonce,
                        data: undefined as any
                    } as any;

                    try {
                        response.data = await sendRendererCommand(IpcCommands.RPC_GET_SELECTED_VOICE_CHANNEL, data);
                    } catch (err: any) {
                        response.data = { error: String(err) } as any;
                    }

                    hostPort.postMessage(response);
                    break;
                }
            }
        });

        if (!voiceIpcRegistered) {
            voiceIpcRegistered = true;
            ipcMain.on(IpcCommands.RPC_VOICE_STATE_UPDATE, (_event, state) => {
                hostPortRef?.postMessage({
                    type: "voice-settings-update",
                    data: state
                });
            });
        }
    } catch (e) {
        console.error("Failed to start arRPC server", e);
    }
}

Settings.addChangeListener("arRPC", initArRPC);
