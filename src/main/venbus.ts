/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { mainWin } from "./mainWindow";

const { Venbus } = require(join(STATIC_DIR, `dist/venbus-${process.arch}.node`)) as typeof import("@vencord/venbus");

const venbus = new Venbus();
venbus.callbackToggleMute = () => {
    mainWin.webContents.send(IpcEvents.AUDIO_TOGGLE_MUTE);
};
venbus.callbackToggleDeafen = () => {
    mainWin.webContents.send(IpcEvents.AUDIO_TOGGLE_DEAFEN);
};

ipcMain.handle(IpcEvents.AUDIO_UPDATE_STATE_MUTED, (_, state: boolean) => {
    venbus.setMuted(state);
});

ipcMain.handle(IpcEvents.AUDIO_UPDATE_STATE_DEAFENED, (_, state: boolean) => {
    venbus.setDeafened(state);
});

venbus.start().catch(err => console.error(`Failed to start venbus: ${err}`));
