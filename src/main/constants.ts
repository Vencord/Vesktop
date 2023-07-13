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
