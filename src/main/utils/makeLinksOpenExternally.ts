import { BrowserWindow, shell } from "electron";
import { Settings } from "../settings";

export function makeLinksOpenExternally(win: BrowserWindow) {
    win.webContents.setWindowOpenHandler(({ url }) => {
        switch (url) {
            case "about:blank":
            case "https://discord.com/popout":
                return { action: "allow" };
        }

        try {
            var protocol = new URL(url).protocol;
        } catch {
            return { action: "deny" };
        }

        switch (protocol) {
            case "http:":
            case "https:":
                if (Settings.openLinksWithElectron) {
                    return { action: "allow" };
                }
            case "mailto:":
            case "steam:":
            case "spotify:":
                shell.openExternal(url);
        }

        return { action: "deny" };
    });
}
