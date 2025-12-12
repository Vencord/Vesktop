/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Settings as TVencordSettings } from "@vencord/types/Vencord";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
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
        try {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, JSON.stringify(o, null, 4));
        } catch (err) {
            console.error(`Failed to save settings to ${name}.json:`, err);
        }
    });

    return store;
}

export const Settings = loadSettings<TSettings>(SETTINGS_FILE, "Vesktop settings");
export const VencordSettings = loadSettings<TVencordSettings>(VENCORD_SETTINGS_FILE, "Vencord settings");
export const State = loadSettings<TState>(STATE_FILE, "Vesktop state");
