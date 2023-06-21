/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app } from "electron";
import { BrowserWindow } from "electron/main";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { STATIC_DIR } from "shared/paths";

import { DATA_DIR } from "./constants";
import { createWindows } from "./mainWindow";
import { Settings } from "./settings";

export function createFirstLaunchTour() {
    const win = new BrowserWindow({
        ...SplashProps,
        frame: true,
        autoHideMenuBar: true,
        height: 320,
        width: 550
    });

    win.loadFile(join(STATIC_DIR, "first-launch.html"));
    win.webContents.addListener("console-message", (_e, _l, msg) => {
        if (msg === "cancel") return app.exit();

        if (!msg.startsWith("form:")) return;
        const data = JSON.parse(msg.slice(5));

        Settings.store.minimizeToTray = data.minimizeToTray;
        Settings.store.discordBranch = data.discordBranch;
        Settings.store.firstLaunch = false;

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
