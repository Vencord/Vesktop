import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Settings as TSettings } from "shared/settings";
import { makeChangeListenerProxy } from "shared/utils/makeChangeListenerProxy";
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
    } catch { }

    const makeSettingsProxy = (settings: T) => makeChangeListenerProxy(
        settings,
        target => writeFileSync(file, JSON.stringify(target, null, 4))
    );

    return [settings, makeSettingsProxy] as const;
}

let [PlainSettings, makeSettingsProxy] = loadSettings<TSettings>(SETTINGS_FILE, "VencordDesktop");
export let Settings = makeSettingsProxy(PlainSettings);

let [PlainVencordSettings, makeVencordSettingsProxy] = loadSettings<any>(VENCORD_SETTINGS_FILE, "Vencord");
export const VencordSettings = makeVencordSettingsProxy(PlainVencordSettings);

export function setSettings(settings: TSettings) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
    PlainSettings = settings;
    Settings = makeSettingsProxy(settings);
}

export {
    PlainSettings,
    PlainVencordSettings,
};
