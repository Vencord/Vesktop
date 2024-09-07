/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { LinkData, Node, PatchBay as PatchBayType } from "@equicord/equimic";
import { app, ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { Settings } from "./settings";

let PatchBay: typeof PatchBayType | undefined;
let patchBayInstance: PatchBayType | undefined;

let imported = false;
let initialized = false;

let hasPipewirePulse = false;
let isGlibCxxOutdated = false;

function importEquimic() {
    if (imported) {
        return;
    }

    imported = true;

    try {
        PatchBay = (
            require(join(STATIC_DIR, `dist/equimic-${process.arch}.node`)) as typeof import("@equicord/equimic")
        ).PatchBay;

        hasPipewirePulse = PatchBay.hasPipeWire();
    } catch (e: any) {
        console.error("Failed to import equimic", e);
        isGlibCxxOutdated = (e?.stack || e?.message || "").toLowerCase().includes("glibc");
    }
}

function obtainEquimic() {
    if (!imported) {
        importEquimic();
    }

    if (PatchBay && !initialized) {
        initialized = true;

        try {
            patchBayInstance = new PatchBay();
        } catch (e: any) {
            console.error("Failed to instantiate equimic", e);
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

    const { granularSelect } = Settings.store.audio ?? {};

    const targets = obtainEquimic()
        ?.list(granularSelect ? ["node.name"] : undefined)
        .filter(s => s["application.process.id"] !== audioPid);

    return targets ? { ok: true, targets, hasPipewirePulse } : { ok: false, isGlibCxxOutdated };
});

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, include: Node[]) => {
    const pid = getRendererAudioServicePid();
    const { ignoreDevices, ignoreInputMedia, ignoreVirtual, workaround } = Settings.store.audio ?? {};

    const data: LinkData = {
        include,
        exclude: [{ "application.process.id": pid }],
        ignore_devices: ignoreDevices
    };

    if (ignoreInputMedia ?? true) {
        data.exclude.push({ "media.class": "Stream/Input/Audio" });
    }

    if (ignoreVirtual) {
        data.exclude.push({ "node.virtual": "true" });
    }

    if (workaround) {
        data.workaround = [{ "application.process.id": pid, "media.name": "RecordStream" }];
    }

    return obtainEquimic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_START_SYSTEM, (_, exclude: Node[]) => {
    const pid = getRendererAudioServicePid();

    const { workaround, ignoreDevices, ignoreInputMedia, ignoreVirtual, onlySpeakers, onlyDefaultSpeakers } =
        Settings.store.audio ?? {};

    const data: LinkData = {
        include: [],
        exclude: [{ "application.process.id": pid }, ...exclude],
        only_speakers: onlySpeakers,
        ignore_devices: ignoreDevices,
        only_default_speakers: onlyDefaultSpeakers
    };

    if (ignoreInputMedia ?? true) {
        data.exclude.push({ "media.class": "Stream/Input/Audio" });
    }

    if (ignoreVirtual) {
        data.exclude.push({ "node.virtual": "true" });
    }

    if (workaround) {
        data.workaround = [{ "application.process.id": pid, "media.name": "RecordStream" }];
    }

    return obtainEquimic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_STOP, () => obtainEquimic()?.unlink());
