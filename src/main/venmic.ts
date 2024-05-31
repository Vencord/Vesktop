/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Node, PatchBay as PatchBayType } from "@vencord/venmic";
import { app, ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { Settings } from "./settings";

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

        try {
            patchBayInstance = new PatchBay();
        } catch (e: any) {
            console.error("Failed to instantiate venmic", e);
        }
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

    const targets = obtainVenmic()
        ?.list(Settings.store.audioGranularSelect ? ["application.process.id"] : undefined)
        .filter(s => s["application.process.id"] !== audioPid);

    return targets ? { ok: true, targets, hasPipewirePulse } : { ok: false, isGlibCxxOutdated };
});

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, targets: Node[]) => {
    const pid = getRendererAudioServicePid();
    const settings = Settings.store;

    const data: LinkData = {
        include: targets,
        exclude: [{ "application.process.id": pid }],
        ignore_devices: settings.audioIgnoreDevices
    };

    if (settings.audioIgnoreInputMedia ?? true) {
        data.exclude?.push({ "media.class": "Stream/Input/Audio" });
    }

    if (settings.audioIgnoreVirtual ?? true) {
        data.exclude?.push({ "node.virtual": "true" });
    }

    if (settings.audioWorkaround) {
        data.workaround = [{ "application.process.id": pid, "media.name": "RecordStream" }];
    }

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_START_SYSTEM, () => {
    const pid = getRendererAudioServicePid();
    const settings = Settings.store;

    const data: LinkData = {
        exclude: [{ "application.process.id": pid }],
        only_speakers: settings.audioOnlySpeakers,
        ignore_devices: settings.audioIgnoreDevices,
        only_default_speakers: settings.audioOnlyDefaultSpeakers
    };

    if (settings.audioIgnoreInputMedia ?? true) {
        data.exclude?.push({ "media.class": "Stream/Input/Audio" });
    }

    if (settings.audioIgnoreVirtual ?? true) {
        data.exclude?.push({ "node.virtual": "true" });
    }

    if (settings.audioWorkaround) {
        data.workaround = [{ "application.process.id": pid, "media.name": "RecordStream" }];
    }

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_STOP, () => obtainVenmic()?.unlink());
