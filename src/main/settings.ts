/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Settings as TSettings } from "shared/settings";
import { SettingsStore } from "shared/utils/SettingsStore";

import { DATA_DIR, VENCORD_SETTINGS_FILE } from "./constants";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");

function loadSettings<T extends object = any>(file: string, name: string) {
    let settings = {} as T;
    try {
        const content = readFileSync(file, "utf8");
        try {
            settings = JSON.parse(content);
        } catch (err) {
            console.error(`Failed to parse ${name} settings.json:`, err);
        }
    } catch {}

    const store = new SettingsStore(settings);
    store.addGlobalChangeListener(o => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(o, null, 4));
    });

    return store;
}

export const Settings = loadSettings<TSettings>(SETTINGS_FILE, "Vesktop");
export const VencordSettings = loadSettings<any>(VENCORD_SETTINGS_FILE, "Vencord");
