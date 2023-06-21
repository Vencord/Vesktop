/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import Server from "arrpc";
import { send as sendToBridge } from "arrpc/src/bridge";

import { Settings } from "./settings";

let server: any;

export async function initArRPC() {
    if (server || !Settings.store.arRPC) return;

    server = await new Server();
    server.on("activity", sendToBridge);
}

Settings.addChangeListener("arRPC", initArRPC);
