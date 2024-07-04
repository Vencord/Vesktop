/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "fs";
import { dirname, join } from "path";

const vesktopDir = dirname(process.execPath);

export const PORTABLE =
    process.platform === "win32" &&
    !process.execPath.toLowerCase().endsWith("electron.exe") &&
    !existsSync(join(vesktopDir, "Uninstall Vesktop.exe"));

const LEGACY_DATA_DIR = join(app.getPath("appData"), "VencordDesktop", "VencordDesktop");
export const DATA_DIR =
    process.env.VENCORD_USER_DATA_DIR || (PORTABLE ? join(vesktopDir, "Data") : join(app.getPath("userData")));

mkdirSync(DATA_DIR, { recursive: true });

// TODO: remove eventually
if (existsSync(LEGACY_DATA_DIR)) {
    try {
        console.warn("Detected legacy settings dir", LEGACY_DATA_DIR + ".", "migrating to", DATA_DIR);
        for (const file of readdirSync(LEGACY_DATA_DIR)) {
            renameSync(join(LEGACY_DATA_DIR, file), join(DATA_DIR, file));
        }
        rmdirSync(LEGACY_DATA_DIR);
        renameSync(
            join(app.getPath("appData"), "VencordDesktop", "IndexedDB"),
            join(DATA_DIR, "sessionData", "IndexedDB")
        );
    } catch (e) {
        console.error("Migration failed", e);
    }
}
const SESSION_DATA_DIR = join(DATA_DIR, "sessionData");
app.setPath("sessionData", SESSION_DATA_DIR);

export const VENCORD_SETTINGS_DIR = join(DATA_DIR, "settings");
export const VENCORD_QUICKCSS_FILE = join(VENCORD_SETTINGS_DIR, "quickCss.css");
export const VENCORD_SETTINGS_FILE = join(VENCORD_SETTINGS_DIR, "settings.json");
export const VENCORD_THEMES_DIR = join(DATA_DIR, "themes");

// needs to be inline require because of circular dependency
// as otherwise "DATA_DIR" (which is used by ./settings) will be uninitialised
export const VENCORD_FILES_DIR =
    (require("./settings") as typeof import("./settings")).State.store.vencordDir ||
    join(SESSION_DATA_DIR, "vencordFiles");

export const USER_AGENT = `Vesktop/${app.getVersion()} (https://github.com/Vencord/Vesktop)`;

// dimensions shamelessly stolen from Discord Desktop :3
export const MIN_WIDTH = 940;
export const MIN_HEIGHT = 500;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;

export const DISCORD_HOSTNAMES = ["discord.com", "canary.discord.com", "ptb.discord.com"];

const BrowserUserAgents = {
    darwin: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    windows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
};

export const BrowserUserAgent = BrowserUserAgents[process.platform] || BrowserUserAgents.windows;

export const enum MessageBoxChoice {
    Default,
    Cancel
}
