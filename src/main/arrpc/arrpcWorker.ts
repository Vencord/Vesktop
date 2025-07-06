/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Server from "arrpc";
import { MessagePort, workerData } from "worker_threads";

import { ArRpcEvent, ArRpcHostEvent } from "./arrpcWorkerTypes";

let server: any;

type InviteCallback = (valid: boolean) => void;
type LinkCallback = InviteCallback;

let inviteCallbacks: Array<InviteCallback> = [];
let linkCallbacks: Array<LinkCallback> = [];

(async function () {
    const { workerPort } = workerData as { workerPort: MessagePort };

    server = await new Server();

    server.on("activity", (data: any) => {
        const event: ArRpcEvent = {
            eventType: "activity",
            data: JSON.stringify(data)
        };
        workerPort.postMessage(event);
    });

    server.on("invite", (invite: string, callback: InviteCallback) => {
        const event: ArRpcEvent = {
            eventType: "invite",
            data: invite,
            inviteId: inviteCallbacks.push(callback) - 1
        };
        workerPort.postMessage(event);
    });

    workerPort.on("message", (e: ArRpcHostEvent) => {
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
