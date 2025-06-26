/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Server from "arrpc";
import { IpcCommands } from "shared/IpcEvents";

import { sendRendererCommand } from "./ipcCommands";
import { Settings } from "./settings";

let server: any;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (server || !Settings.store.arRPC) return;

    try {
        server = await new Server();
        server.on("activity", (data: any) => sendRendererCommand(IpcCommands.RPC_ACTIVITY, JSON.stringify(data)));
        server.on("invite", async (invite: string, callback: (valid: boolean) => void) => {
            invite = String(invite);
            if (!inviteCodeRegex.test(invite)) return callback(false);

            await sendRendererCommand(IpcCommands.RPC_INVITE, invite).then(callback);
        });
        server.on("link", async (data: any, deepCallback: (valid: boolean) => void) => {
            await sendRendererCommand(IpcCommands.RPC_DEEP_LINK, data).then(deepCallback);
        });
    } catch (e) {
        console.error("Failed to start arRPC server", e);
    }
}

Settings.addChangeListener("arRPC", initArRPC);
