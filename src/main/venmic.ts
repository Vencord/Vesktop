/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LinkData, Node, PatchBay as PatchBayType } from "@vencord/venmic";
import { app, ipcMain } from "electron";
import { readFileSync } from "fs";
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

function getPpid(pid: string): string | undefined {
    try {
        return readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s*(\d+)/m)?.[1];
    } catch {
        return undefined;
    }
}

// Walks pid's ancestry; returns the topmost PID that itself owns an audio node.
// Used to group child audio processes (e.g. FMOD subprocess) under their parent app.
function findGroupRoot(pid: string, audioPids: Set<string>): string {
    let root = pid;
    let cur: string | undefined = pid;
    for (let depth = 0; depth < 16; depth++) {
        const ppid = getPpid(cur);
        if (!ppid || ppid === "0" || ppid === cur) break;
        if (audioPids.has(ppid)) root = ppid;
        cur = ppid;
    }
    return root;
}

function nodeMatchesFilter(filter: Node, node: Node): boolean {
    return Object.keys(filter).every(k => (filter as any)[k] === (node as any)[k]);
}

function expandWithProcessGroup(filters: Node[], audioPid: string): Node[] {
    const venmic = obtainVenmic();
    if (!venmic) return filters;

    const all = venmic.list().filter(s => s["application.process.id"] !== audioPid);
    const audioPids = new Set<string>();
    for (const n of all) {
        const p = n["application.process.id"];
        if (p) audioPids.add(p);
    }
    if (audioPids.size === 0) return filters;

    const groupRoot = new Map<string, string>();
    for (const p of audioPids) groupRoot.set(p, findGroupRoot(p, audioPids));

    const wantedRoots = new Set<string>();
    for (const f of filters) {
        for (const n of all) {
            const p = n["application.process.id"];
            if (p && nodeMatchesFilter(f, n)) wantedRoots.add(groupRoot.get(p)!);
        }
    }
    if (wantedRoots.size === 0) return filters;

    const extras: Node[] = [];
    for (const n of all) {
        const p = n["application.process.id"];
        if (!p) continue;
        const root = groupRoot.get(p);
        if (!root || !wantedRoots.has(root)) continue;
        if (filters.some(f => nodeMatchesFilter(f, n))) continue;
        extras.push({ "application.process.id": p } as Node);
    }
    return extras.length ? [...filters, ...extras] : filters;
}

ipcMain.handle(IpcEvents.VIRT_MIC_LIST, () => {
    const audioPid = getRendererAudioServicePid();

    const { granularSelect } = Settings.store.audio ?? {};

    const targets = obtainVenmic()
        ?.list(granularSelect ? ["node.name"] : undefined)
        .filter(s => s["application.process.id"] !== audioPid);

    return targets ? { ok: true, targets, hasPipewirePulse } : { ok: false, isGlibCxxOutdated };
});

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, include: Node[]) => {
    const pid = getRendererAudioServicePid();
    const { ignoreDevices, ignoreInputMedia, ignoreVirtual, workaround, granularSelect } = Settings.store.audio ?? {};

    const data: LinkData = {
        include: granularSelect ? include : expandWithProcessGroup(include, pid),
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

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_START_SYSTEM, (_, exclude: Node[]) => {
    const pid = getRendererAudioServicePid();

    const {
        workaround,
        ignoreDevices,
        ignoreInputMedia,
        ignoreVirtual,
        onlySpeakers,
        onlyDefaultSpeakers,
        granularSelect
    } = Settings.store.audio ?? {};

    const expandedExclude = granularSelect ? exclude : expandWithProcessGroup(exclude, pid);

    const data: LinkData = {
        include: [],
        exclude: [{ "application.process.id": pid }, ...expandedExclude],
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

    return obtainVenmic()?.link(data);
});

ipcMain.handle(IpcEvents.VIRT_MIC_STOP, () => obtainVenmic()?.unlink());
