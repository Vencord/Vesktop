/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { PatchBay as PatchBayType } from "@vencord/venmic";
import { app, ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

type LinkData = Parameters<PatchBayType["link"]>[0];

let PatchBay: typeof PatchBayType | undefined;
let patchBayInstance: PatchBayType | undefined;

let imported = false;
let initialized = false;

let hasPipewirePulse = false;
let isGlibCxxOutdated = false;

function importVenmic() {
    if (imported) {
        return;
    }

    imported = true;

    try {
        PatchBay = (require(join(STATIC_DIR, `dist/venmic-${process.arch}.node`)) as typeof import("@vencord/venmic"))
            .PatchBay;

        hasPipewirePulse = PatchBay.hasPipeWire();
    } catch (e: any) {
        console.error("Failed to import venmic", e);
        isGlibCxxOutdated = (e?.stack || e?.message || "").toLowerCase().includes("glibc");
    }
}

function obtainVenmic() {
    if (!imported) {
        importVenmic();
    }

    if (PatchBay && !initialized) {
        initialized = true;
        patchBayInstance = new PatchBay();
    }

    return patchBayInstance;
}

function getRendererAudioServicePid() {
    return (
        app
            .getAppMetrics()
            .find(proc => proc.name === "Audio Service")
            ?.pid?.toString() ?? "owo"
    );
}

ipcMain.handle(IpcEvents.VIRT_MIC_LIST, () => {
    const audioPid = getRendererAudioServicePid();

    const list = obtainVenmic()
        ?.list()
        .filter(s => s["application.process.id"] !== audioPid)
        .map(s => s["application.name"]);

    const uniqueTargets = [...new Set(list)];

    return list ? { ok: true, targets: uniqueTargets, hasPipewirePulse } : { ok: false, isGlibCxxOutdated };
});

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, targets: string[], workaround?: boolean) => {
    const pid = getRendererAudioServicePid();

    const data: LinkData = {
        include: targets.map(target => ({ key: "application.name", value: target })),
        exclude: [{ key: "application.process.id", value: pid }]
    };

    if (workaround) {
        data.workaround = [
            { key: "application.process.id", value: pid },
            { key: "media.name", value: "RecordStream" }
        ];
    }

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_START_SYSTEM, (_, workaround?: boolean, onlyDefaultSpeakers?: boolean) => {
    const pid = getRendererAudioServicePid();

    const data: LinkData = {
        exclude: [{ key: "application.process.id", value: pid }],
        only_default_speakers: onlyDefaultSpeakers
    };

    if (workaround) {
        data.workaround = [
            { key: "application.process.id", value: pid },
            { key: "media.name", value: "RecordStream" }
        ];
    }

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_STOP, () => obtainVenmic()?.unlink());
