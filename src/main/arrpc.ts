/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { resolve } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { MessageChannel, Worker } from "worker_threads";

import { mainWin } from "./mainWindow";
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
        hostPort.on("message", (e: ArrpcEvent) => {
            switch (e.eventType) {
                case IpcEvents.ARRPC_ACTIVITY: {
                    mainWin.webContents.send(IpcEvents.ARRPC_ACTIVITY, e.data);
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

                    mainWin.webContents
                        // Safety: Result of JSON.stringify should always be safe to equal
                        // Also, just to be super super safe, invite is regex validated above
                        .executeJavaScript(`Vesktop.openInviteModal(${JSON.stringify(invite)})`)
                        .then(() => {
                            const hostEvent: ArrpcHostEvent = {
                                eventType: "ack-invite",
                                data: true,
                                inviteId: e.inviteId
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
