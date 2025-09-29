/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { BrowserWindow } from "electron/main";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { VIEW_DIR } from "shared/paths";

import { autoStart } from "./autoStart";
import { DATA_DIR } from "./constants";
import { createWindows } from "./mainWindow";
import { Settings, State } from "./settings";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";

interface Data {
    discordBranch: "stable" | "canary" | "ptb";
    minimizeToTray?: "on";
    autoStart?: "on";
    importSettings?: "on";
    richPresence?: "on";
}

export function createFirstLaunchTour() {
    const win = new BrowserWindow({
        ...SplashProps,
        transparent: false,
        frame: true,
        autoHideMenuBar: true,
        height: 470,
        width: 550
    });

    makeLinksOpenExternally(win);

    win.loadFile(join(VIEW_DIR, "first-launch.html"));
    win.webContents.addListener("console-message", (_e, _l, msg) => {
        if (msg === "cancel") return app.exit();

        if (!msg.startsWith("form:")) return;
        const data = JSON.parse(msg.slice(5)) as Data;

        console.log(data);
        State.store.firstLaunch = false;
        Settings.store.discordBranch = data.discordBranch;
        Settings.store.minimizeToTray = !!data.minimizeToTray;
        Settings.store.arRPC = !!data.richPresence;

        if (data.autoStart) autoStart.enable();

        if (data.importSettings) {
            const from = join(app.getPath("userData"), "..", "Vencord", "settings");
            const to = join(DATA_DIR, "settings");
            try {
                const files = readdirSync(from);
                mkdirSync(to, { recursive: true });

                for (const file of files) {
                    copyFileSync(join(from, file), join(to, file));
                }
            } catch (e) {
                console.error("Failed to import settings:", e);
            }
        }

        win.close();

        createWindows();
    });
}
