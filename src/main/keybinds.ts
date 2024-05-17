/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

export function initKeybinds() {
    process.title = "Vesktop";
    process.on("SIGPIPE", async () => {
        mainWin.webContents.send(IpcEvents.TOGGLE_SELF_MUTE);
    });

    process.on("SIGUSR2", () => {
        mainWin.webContents.send(IpcEvents.TOGGLE_SELF_DEAF);
    });
}
