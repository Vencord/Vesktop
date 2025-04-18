/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import Server from "arrpc";
import { IpcEvents } from "shared/IpcEvents";
import { MessagePort, workerData } from "worker_threads";

import { ArrpcEvent, ArrpcHostEvent } from "./utils/arrpcWorkerTypes";

let server: any;

type InviteCallback = (valid: boolean) => void;
type LinkCallback = InviteCallback;

let inviteCallbacks: Array<InviteCallback> = [];
let linkCallbacks: Array<LinkCallback> = [];

(async function () {
    const { workerPort }: { workerPort: MessagePort } = workerData;
    server = await new Server();
    server.on("activity", (data: any) => {
        const event: ArrpcEvent = {
            eventType: IpcEvents.ARRPC_ACTIVITY,
            data: JSON.stringify(data)
        };
        workerPort.postMessage(event);
    });
    server.on("invite", (invite: string, callback: InviteCallback) => {
        const event: ArrpcEvent = {
            eventType: "invite",
            data: invite,
            inviteId: inviteCallbacks.push(callback) - 1
        };
        workerPort.postMessage(event);
    });

    workerPort.on("message", (e: ArrpcHostEvent) => {
        switch (e.eventType) {
            case "ack-invite": {
                inviteCallbacks[e.inviteId](e.data);
                inviteCallbacks = [...inviteCallbacks.slice(0, e.inviteId), ...inviteCallbacks.slice(e.inviteId + 1)];
                break;
            }
            case "ack-link": {
                linkCallbacks[e.linkId](e.data);
                linkCallbacks = [...inviteCallbacks.slice(0, e.linkId), ...inviteCallbacks.slice(e.linkId + 1)];
                break;
            }
        }
    });
})();
