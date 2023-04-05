import { BrowserWindow } from "electron";
import { join } from "path";
import { ICON_PATH, STATIC_DIR } from "shared/paths";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";

export function createAboutWindow() {
    const about = new BrowserWindow({
        center: true,
        autoHideMenuBar: true,
        icon: ICON_PATH
    });

    makeLinksOpenExternally(about);

    about.loadFile(join(STATIC_DIR, "about.html"));

    return about;
}
