/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { resolve } from "path";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";
import { MessageChannel, Worker } from "worker_threads";

import { sendRendererCommand } from "./ipcCommands";
import { Settings } from "./settings";
import { ArrpcEvent, ArrpcHostEvent } from "./utils/arrpcWorkerTypes";

let worker: any;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (worker || !Settings.store.arRPC) return;

    try {
        const { port1: hostPort, port2: workerPort } = new MessageChannel();
        worker = new Worker(resolve(__dirname, "./arrpcWorker.js"), {
            workerData: {
                workerPort
            },
            transferList: [workerPort]
        });
        hostPort.on("message", async (e: ArrpcEvent) => {
            switch (e.eventType) {
                case IpcEvents.ARRPC_ACTIVITY: {
                    sendRendererCommand(IpcCommands.RPC_ACTIVITY, e.data);
                    break;
                }
                case "invite": {
                    const invite = String(e.data);

                    if (!inviteCodeRegex.test(invite)) {
                        const hostEvent: ArrpcHostEvent = {
                            eventType: "ack-invite",
                            data: false,
                            inviteId: e.inviteId
                        };
                        return hostPort.postMessage(hostEvent);
                    }

                    await sendRendererCommand(IpcCommands.RPC_INVITE, invite).then(() => {
                        const hostEvent: ArrpcHostEvent = {
                            eventType: "ack-invite",
                            data: true,
                            inviteId: e.inviteId
                        };
                        hostPort.postMessage(hostEvent);
                    });

                    break;
                }
                case "link": {
                    const link = String(e.data);
                    if (!inviteCodeRegex.test(link)) {
                        const hostEvent: ArrpcHostEvent = {
                            eventType: "ack-link",
                            data: false,
                            linkId: e.linkId
                        };
                        return hostPort.postMessage(hostEvent);
                    }

                    await sendRendererCommand(IpcCommands.RPC_DEEP_LINK, link).then(() => {
                        const hostEvent: ArrpcHostEvent = {
                            eventType: "ack-link",
                            data: true,
                            linkId: e.linkId
                        };
                        hostPort.postMessage(hostEvent);
                    });

                    break;
                }
            }
        });
    } catch (e) {
        console.error("Failed to start arRPC server", e);
    }
}

Settings.addChangeListener("arRPC", initArRPC);
