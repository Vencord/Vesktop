/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, stat, writeFile } from "fs/promises";

import type { DetectableGame, RunningGame } from "@vencord/game-detection";

const DATABASE_URL = "https://discord.com/api/v9/applications/detectable";
const DATABASE_MAX_AGE = 24 * 60 * 60 * 1000;
const SCAN_INTERVAL = 5000;

// Used to toggle streamer mode, not a real application
export const STREAMER_MODE_ID = "STREAMERMODE";
const OBS: DetectableGame = {
    id: STREAMER_MODE_ID,
    name: "OBS",
    executables: [
        { is_launcher: false, name: "obs", os: "linux" },
        { is_launcher: false, name: "obs.exe", os: "win32" }
    ]
};

export type { RunningGame as DetectedGame } from "@vencord/game-detection";

export interface GameDetectionOptions {
    // Path of the native addon. It can't be bundled, so the host decides where it lives
    nativePath: string;
    cachePath: string;
    onChange(game: RunningGame, running: boolean): void;
}

async function loadDatabase(cachePath: string): Promise<DetectableGame[]> {
    const stats = await stat(cachePath).catch(() => null);

    if (!stats || Date.now() - stats.mtimeMs > DATABASE_MAX_AGE) {
        try {
            const res = await fetch(DATABASE_URL, {
                headers: stats ? { "If-Modified-Since": stats.mtime.toUTCString() } : {}
            });

            if (res.ok) await writeFile(cachePath, await res.text());
            else if (res.status !== 304) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            console.warn("[RPC:Games] Failed to update database, continuing with cached one:", e);
        }
    }

    return JSON.parse(await readFile(cachePath, "utf8"));
}

export function startGameDetection({ nativePath, cachePath, onChange }: GameDetectionOptions) {
    const games = new Map<string, RunningGame>();
    let stopped = false;
    let interval: NodeJS.Timeout | undefined;

    async function init() {
        const native: typeof import("@vencord/game-detection") = require(nativePath);

        const database = await loadDatabase(cachePath);
        if (stopped) return;

        native.setDetectableDatabase([...database, OBS]);

        const scan = async () => {
            try {
                const running = await native.getRunningGames();

                for (const game of running) {
                    if (games.has(game.id)) continue;

                    games.set(game.id, game);
                    onChange(game, true);
                }

                for (const game of games.values()) {
                    if (running.some(g => g.id === game.id)) continue;

                    games.delete(game.id);
                    onChange(game, false);
                }
            } catch (e) {
                console.error("[RPC:Games] Failed to scan for games:", e);
            }
        };

        scan();
        interval = setInterval(scan, SCAN_INTERVAL);
    }

    init().catch(e => console.error("[RPC:Games] Game detection unavailable:", e));

    return {
        getGames: () => [...games.values()],
        stop() {
            stopped = true;
            clearInterval(interval);
        }
    };
}
