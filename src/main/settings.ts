/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { SettingsV1, StateV1 } from "shared/settings";
import { SettingsStore } from "shared/utils/SettingsStore";

import { DATA_DIR, VENCORD_SETTINGS_FILE } from "./constants";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const STATE_FILE = join(DATA_DIR, "state.json");

function readSettings(file: string, description: string) {
    try {
        const content = readFileSync(file, "utf8");
        try {
            return JSON.parse(content);
        } catch (err) {
            console.error(`Failed to parse ${description}:`, err);
        }
    } catch {}
    return {};
}

function createSettingsStore<T extends object = any>(file: string, settings: T) {
    const store = new SettingsStore(settings);
    store.addGlobalChangeListener(o => {
        mkdirSync(dirname(file), { recursive: true });
        try {
            writeFileSync(file, JSON.stringify(o, null, 4));
        } catch (err) {
            console.error(`Failed to save ${file}`, err);
        }
    });

    return store;
}

function loadVesktopSettings() {
    // settingsData is any to allow for migration below
    let settingsData = readSettings(SETTINGS_FILE, "Vesktop settings.json");
    let stateData = readSettings(STATE_FILE, "Vesktop state.json") as StateV1;

    // take stateDate from settings if we haven't migrated to settings v1 yet
    if (settingsData.formatVersion ?? 0 < 1) {
        stateData = settingsData as StateV1;
    }
    settingsData = settingsData as SettingsV1;

    const Settings = createSettingsStore<SettingsV1>(SETTINGS_FILE, settingsData);
    const State = createSettingsStore<StateV1>(STATE_FILE, stateData);
    return {
        Settings,
        State
    };
}

export const { Settings, State } = loadVesktopSettings();
export const VencordSettings = createSettingsStore<any>(
    VENCORD_SETTINGS_FILE,
    readSettings(VENCORD_SETTINGS_FILE, "Vencord settings.json")
);
