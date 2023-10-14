/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

let initialized = false;
let patchBay: import("venmic").PatchBay | undefined;

function getRendererAudioServicePid() {
    return (
        app
            .getAppMetrics()
            .find(proc => proc.name === "Audio Service")
            ?.pid?.toString() ?? "owo"
    );
}

function obtainVenmic() {
    if (!initialized) {
        initialized = true;
        try {
            const { PatchBay } = require(join(STATIC_DIR, "dist/venmic.node")) as typeof import("venmic");
            patchBay = new PatchBay();
        } catch (e) {
            console.error("Failed to initialise venmic. Make sure you're using pipewire", e);
        }
    }

    return patchBay;
}

ipcMain.handle(IpcEvents.VIRT_MIC_LIST, () => {
    const audioPid = getRendererAudioServicePid();
    return obtainVenmic()
        ?.list()
        ?.filter(s => s["application.process.id"] !== audioPid)
        ?.map(s => s["node.name"]);
});

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, target: string) => obtainVenmic()?.link("node.name", target, "include"));

ipcMain.handle(
    IpcEvents.VIRT_MIC_START_SYSTEM,
    () => obtainVenmic()?.link("application.process.id", getRendererAudioServicePid(), "exclude")
);

ipcMain.handle(IpcEvents.VIRT_MIC_KILL, () => obtainVenmic()?.unlink());
