/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { resolve } from "path";
import { IpcCommands } from "shared/IpcEvents";
import { MessageChannel, Worker } from "worker_threads";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";
import { ArRpcEvent, ArRpcHostEvent } from "./types";

let worker: Worker;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (worker || !Settings.store.arRPC) return;

    try {
        const { port1: hostPort, port2: workerPort } = new MessageChannel();

        worker = new Worker(resolve(__dirname, "./arRpcWorker.js"), {
            workerData: {
                workerPort
            },
            transferList: [workerPort]
        });

        hostPort.on("message", async (e: ArRpcEvent) => {
            switch (e.type) {
                case "activity": {
                    sendRendererCommand(IpcCommands.RPC_ACTIVITY, e.data);
                    break;
                }

                case "invite": {
                    const invite = String(e.data);

                    const response: ArRpcHostEvent = {
                        type: "ack-invite",
                        nonce: e.nonce,
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
                    const link = String(e.data);

                    const response: ArRpcHostEvent = {
                        type: "ack-link",
                        nonce: e.nonce,
                        data: false
                    };

                    if (!inviteCodeRegex.test(link)) {
                        return hostPort.postMessage(response);
                    }

                    response.data = await sendRendererCommand(IpcCommands.RPC_DEEP_LINK, link).catch(() => false);

                    hostPort.postMessage(response);
                    break;
                }
            }
        });
    } catch (e) {
        console.error("Failed to start arRPC server", e);
    }
}

Settings.addChangeListener("arRPC", initArRPC);
