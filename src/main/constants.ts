import { app } from "electron";
import { join } from "path";

export const DATA_DIR = process.env.VENCORD_USER_DATA_DIR ?? join(app.getPath("userData"), "VencordDesktop");
export const VENCORD_FILES_DIR = join(DATA_DIR, "vencordDist");
export const VENCORD_SETTINGS_DIR = join(DATA_DIR, "settings");
export const VENCORD_QUICKCSS_FILE = join(VENCORD_SETTINGS_DIR, "quickCss.css");
export const VENCORD_SETTINGS_FILE = join(VENCORD_SETTINGS_DIR, "settings.json");

export const USER_AGENT = `VencordDesktop/${app.getVersion()} (https://github.com/Vencord/Electron)`;
