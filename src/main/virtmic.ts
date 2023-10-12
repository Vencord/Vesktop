/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

const importVenmic = () => require(join(STATIC_DIR, "dist/venmic.node")) as typeof import("venmic");

ipcMain.handle(IpcEvents.VIRT_MIC_LIST, async () =>
    importVenmic()
        .list()
        .map(m => m.name)
);

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, target: string) => {
    importVenmic().link(target);
});

ipcMain.handle(IpcEvents.VIRT_MIC_KILL, () => importVenmic().unlink());
