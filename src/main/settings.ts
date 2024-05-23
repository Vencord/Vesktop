/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Settings as TSettings, State as TState } from "shared/settings";
import { SettingsStore } from "shared/utils/SettingsStore";

import { DATA_DIR, VENCORD_SETTINGS_FILE } from "./constants";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const STATE_FILE = join(DATA_DIR, "state.json");

function loadSettings<T extends object = any>(file: string, name: string) {
    let settings = {} as T;
    try {
        const content = readFileSync(file, "utf8");
        try {
            settings = JSON.parse(content);
        } catch (err) {
            console.error(`Failed to parse ${name}.json:`, err);
        }
    } catch {}

    const store = new SettingsStore(settings);
    store.addGlobalChangeListener(o => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(o, null, 4));
    });

    return store;
}

export const Settings = loadSettings<TSettings>(SETTINGS_FILE, "Vesktop settings");

export const VencordSettings = loadSettings<any>(VENCORD_SETTINGS_FILE, "Vencord settings");

if (Object.hasOwn(Settings.plain, "firstLaunch") && !existsSync(STATE_FILE)) {
    console.warn("legacy state in settings.json detected. migrating to state.json");
    const state = {} as TState;
    for (const prop of [
        "firstLaunch",
        "maximized",
        "minimized",
        "skippedUpdate",
        "steamOSLayoutVersion",
        "windowBounds"
    ] as const) {
        state[prop] = Settings.plain[prop];
        delete Settings.plain[prop];
    }
    Settings.markAsChanged();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 4));
}

export const State = loadSettings<TState>(STATE_FILE, "Vesktop state");
