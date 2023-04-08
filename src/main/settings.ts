import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Settings as TSettings } from "shared/settings";
import { makeChangeListenerProxy } from "shared/utils/makeChangeListenerProxy";
import { DATA_DIR } from "./constants";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export let PlainSettings = {} as TSettings;
try {
    const content = readFileSync(SETTINGS_FILE, "utf8");
    try {
        PlainSettings = JSON.parse(content);
    } catch (err) {
        console.error("Failed to parse settings.json:", err);
    }
} catch { }

const makeSettingsProxy = (settings: TSettings) => makeChangeListenerProxy(
    settings,
    target => writeFileSync(SETTINGS_FILE, JSON.stringify(target, null, 4))
);

export let Settings = makeSettingsProxy(PlainSettings);

export function setSettings(settings: TSettings) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
    PlainSettings = settings;
    Settings = makeSettingsProxy(settings);
}

