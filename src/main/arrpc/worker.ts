/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Server from "arrpc";
import { randomUUID } from "crypto";
import { MessagePort, workerData } from "worker_threads";

import { ArRpcEvent, ArRpcHostEvent } from "./types";

let server: any;

type InviteCallback = (valid: boolean) => void;
type LinkCallback = InviteCallback;

const inviteCallbacks = new Map<string, InviteCallback>();
const linkCallbacks = new Map<string, LinkCallback>();

(async function () {
    const { workerPort } = workerData as { workerPort: MessagePort };

    server = await new Server();

    server.on("activity", (data: any) => {
        const event: ArRpcEvent = {
            type: "activity",
            data: JSON.stringify(data),
            nonce: randomUUID()
        };
        workerPort.postMessage(event);
    });

    server.on("invite", (invite: string, callback: InviteCallback) => {
        const nonce = randomUUID();
        inviteCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "invite",
            data: invite,
            nonce
        };
        workerPort.postMessage(event);
    });

    server.on("link", async (data: any, callback: LinkCallback) => {
        const nonce = randomUUID();
        linkCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "link",
            data,
            nonce
        };
        workerPort.postMessage(event);
    });

    workerPort.on("message", (e: ArRpcHostEvent) => {
        switch (e.type) {
            case "ack-invite": {
                inviteCallbacks.get(e.nonce)?.(e.data);
                inviteCallbacks.delete(e.nonce);
                break;
            }
            case "ack-link": {
                linkCallbacks.get(e.nonce)?.(e.data);
                linkCallbacks.delete(e.nonce);
                break;
            }
        }
    });
})();
