/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app } from "electron";
import { join } from "path";

export const DATA_DIR = process.env.VENCORD_USER_DATA_DIR || join(app.getPath("userData"), "VencordDesktop");
export const VENCORD_SETTINGS_DIR = join(DATA_DIR, "settings");
export const VENCORD_QUICKCSS_FILE = join(VENCORD_SETTINGS_DIR, "quickCss.css");
export const VENCORD_SETTINGS_FILE = join(VENCORD_SETTINGS_DIR, "settings.json");
export const VENCORD_THEMES_DIR = join(DATA_DIR, "themes");

// needs to be inline require because of circular dependency
// as otherwise "DATA_DIR" (which is used by ./settings) will be uninitialised
export const VENCORD_FILES_DIR =
    (require("./settings") as typeof import("./settings")).Settings.store.vencordDir || join(DATA_DIR, "vencordDist");

export const USER_AGENT = `Vesktop/${app.getVersion()} (https://github.com/Vencord/Vesktop)`;

// dimensions shamelessly stolen from Discord Desktop :3
export const MIN_WIDTH = 940;
export const MIN_HEIGHT = 500;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;

const UserAgents = {
    darwin: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    windows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

export const UserAgent = UserAgents[process.platform] || UserAgents.windows;

export const enum MessageBoxChoice {
    Default,
    Cancel
}
