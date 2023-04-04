import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./constants";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");

interface Settings {
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    discordBranch: "stable" | "canary" | "ptb";
}

export let PlainSettings = {} as Settings;
try {
    const content = readFileSync(SETTINGS_FILE, "utf8");
    try {
        PlainSettings = JSON.parse(content);
    } catch (err) {
        console.error("Failed to parse settings.json:", err);
    }
} catch { }

function makeSettingsProxy(settings: Settings) {
    return new Proxy(settings, {
        set(target, prop, value) {
            Reflect.set(target, prop, value);

            writeFileSync(SETTINGS_FILE, JSON.stringify(target, null, 4));

            return true;
        }
    });
}

export let Settings = makeSettingsProxy(PlainSettings);

export function setSettings(settings: Settings) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
    PlainSettings = settings;
    Settings = makeSettingsProxy(settings);
}

