/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import Server from "arrpc";

import { mainWin } from "./mainWindow";
import { Settings } from "./settings";

let server: any;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (server || !Settings.store.arRPC) return;

    try {
        // This module starts a server as a side effect, so it needs to be lazy imported
        const { send: sendToBridge } = await import("arrpc/src/bridge");

        server = await new Server();
        server.on("activity", sendToBridge);
        server.on("invite", (invite: string, callback: (valid: boolean) => void) => {
            invite = String(invite);
            if (!inviteCodeRegex.test(invite)) return callback(false);

            mainWin.webContents
                // Safety: Result of JSON.stringify should always be safe to equal
                // Also, just to be super super safe, invite is regex validated above
                .executeJavaScript(`Vesktop.openInviteModal(${JSON.stringify(invite)})`)
                .then(callback);
        });
    } catch (e) {
        console.error("Failed to start arRPC server", e);
    }
}

Settings.addChangeListener("arRPC", initArRPC);
