/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, session } from "electron";

import { Settings } from "./settings";

const PERFORMANCE_FLAGS = [
    "--enable-gpu-rasterization",
    "--enable-zero-copy",
    "--ignore-gpu-blocklist",
    "--enable-hardware-overlays=single-fullscreen,single-on-top,underlay",
    "--enable-features=EnableDrDc,CanvasOopRasterization,BackForwardCache:TimeToLiveInBackForwardCacheInSeconds/300/should_ignore_blocklists/true/enable_same_site/true,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,UseSkiaRenderer,WebAssemblyLazyCompilation",
    "--disable-features=Vulkan",
    "--force_high_performance_gpu"
];

const BATTERY_FLAGS = ["--enable-features=TurnOffStreamingMediaCachingOnBattery", "--force_low_power_gpu"];

export function isOpenAsarEnabled(): boolean {
    return Settings.store.openAsarEnabled !== false;
}

export function applyOpenAsarCmdSwitches(): void {
    if (!isOpenAsarEnabled()) return;
    const openAsar = Settings.store.openAsar ?? {};

    const flagsToApply: string[] = [];

    if (openAsar.performanceMode !== false) {
        flagsToApply.push(...PERFORMANCE_FLAGS);
    }

    if (openAsar.batteryMode === true) {
        flagsToApply.push(...BATTERY_FLAGS);
    }

    if (openAsar.customFlags) {
        flagsToApply.push(...openAsar.customFlags.split(" ").filter(Boolean));
    }

    const parsed: Record<string, string[]> = {};
    for (const flag of flagsToApply) {
        if (!flag) continue;
        const [key, value] = flag.split("=");
        const cleanKey = key.replace("--", "");
        (parsed[cleanKey] = parsed[cleanKey] || []).push(value);
    }

    for (const [key, values] of Object.entries(parsed)) {
        const value = values.filter(Boolean).join(",");
        if (value) {
            app.commandLine.appendSwitch(key, value);
        } else {
            app.commandLine.appendSwitch(key);
        }
    }
}

export function applyOpenAsarPulseLatency(): void {
    if (process.platform === "linux") {
        process.env.PULSE_LATENCY_MSEC = process.env.PULSE_LATENCY_MSEC ?? "30";
    }
}

export function setupOpenAsarWebRequestBlocking(): void {
    if (!isOpenAsarEnabled()) return;
    const { openAsar } = Settings.store;

    const urls: string[] = [];

    if (openAsar.noTrack !== false) {
        urls.push("https://*/api/*/science", "https://*/api/*/metrics");
    }

    if (openAsar.noTyping === true) {
        urls.push("https://*/api/*/typing");
    }

    if (urls.length > 0) {
        session.defaultSession.webRequest.onBeforeRequest({ urls }, (_details, callback) => callback({ cancel: true }));
    }
}

export function getOpenAsarDomOptimizerScript(): string {
    if (!isOpenAsarEnabled()) return "";
    const { openAsar } = Settings.store;
    if (openAsar?.domOptimizer === false) return "";

    return `
(function() {
    const optimize = orig => function(...args) {
        if (typeof args[0]?.className === 'string' && args[0].className.indexOf('activity') !== -1) {
            return setTimeout(() => orig.apply(this, args), 100);
        }
        return orig.apply(this, args);
    };
    Element.prototype.removeChild = optimize(Element.prototype.removeChild);
})();
`;
}

export function getOpenAsarNoTrackScript(): string {
    if (!isOpenAsarEnabled()) return "";
    const { openAsar } = Settings.store;
    if (openAsar?.noTrack === false) return "";

    return `
(function() {
    try {
        if (window.__SENTRY__?.hub?.getClient?.()?.getOptions?.()) {
            window.__SENTRY__.hub.getClient().getOptions().enabled = false;
        }
        Object.keys(console).forEach(x => {
            if (console[x]?.__sentry_original__) {
                console[x] = console[x].__sentry_original__;
            }
        });
    } catch {}
})();
`;
}

export function injectModuleGlobalPaths(): void {
    const Module = require("module");
    const { join } = require("path");
    const { existsSync, readdirSync } = require("fs");

    const exeDir = require("path").dirname(app.getPath("exe"));
    const modulesDir = join(exeDir, "modules");

    if (process.platform === "win32" && existsSync(modulesDir)) {
        try {
            for (const m of readdirSync(modulesDir)) {
                Module.globalPaths.unshift(join(modulesDir, m));
            }
        } catch {}
    }

    const originalResolveLookupPaths = Module._resolveLookupPaths;
    Module._resolveLookupPaths = (request: string, parent: { paths?: string[] }) => {
        if (parent?.paths?.length) {
            parent.paths = parent.paths.concat(Module.globalPaths);
        }
        return originalResolveLookupPaths(request, parent);
    };
}

export function shouldAllowMultiInstance(): boolean {
    const { openAsar } = Settings.store;
    return process.argv?.includes?.("--multi-instance") || openAsar?.multiInstance === true;
}

export function isQuickstartEnabled(): boolean {
    if (!isOpenAsarEnabled()) return false;
    const { openAsar } = Settings.store;
    return process.env.VESKTOP_QUICKSTART === "true" || openAsar?.quickstart === true;
}
