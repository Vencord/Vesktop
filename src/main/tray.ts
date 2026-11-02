/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, Menu, Tray } from "electron";

import { createAboutWindow } from "./about";
import { AppEvents } from "./events";
import { Settings } from "./settings";
import { resolveAssetPath } from "./userAssets";
import { clearData } from "./utils/clearData";
import { relaunch } from "./utils/relaunch";
import { showWindow } from "./utils/showWindow";
import { downloadVencordFiles } from "./utils/vencordLoader";

let tray: Tray | undefined;
let trayVariant: "tray" | "trayUnread" = "tray";

// resolve the image before checking tray, as it might get destroyed in the meantime
AppEvents.on("userAssetChanged", async asset => {
    if (asset !== "tray" && asset !== "trayUnread") return;

    const image = await resolveAssetPath(trayVariant);
    tray?.setImage(image);
});

AppEvents.on("setTrayVariant", async variant => {
    if (trayVariant === variant) return;

    trayVariant = variant;
    const image = await resolveAssetPath(trayVariant);
    tray?.setImage(image);
});

export function destroyTray() {
    tray?.destroy();
    tray = undefined;
}

export async function initTray(win: BrowserWindow, setIsQuitting: (val: boolean) => void) {
    const onTrayClick = () => {
        if (Settings.store.clickTrayToShowHide && win.isVisible()) win.hide();
        else showWindow(win);
    };

    const trayMenu = Menu.buildFromTemplate([
        {
            label: "Open",
            click() {
                showWindow(win);
            }
        },
        {
            label: "About",
            click: createAboutWindow
        },
        {
            label: "Repair Vencord",
            async click() {
                await downloadVencordFiles();
                relaunch();
            }
        },
        {
            label: "Reset Vesktop",
            async click() {
                await clearData(win);
            }
        },
        {
            type: "separator"
        },
        {
            label: "Restart",
            click: relaunch
        },
        {
            label: "Quit",
            click() {
                setIsQuitting(true);
                app.quit();
            }
        }
    ]);

    tray = new Tray(await resolveAssetPath(trayVariant));
    tray.setToolTip("Vesktop");
    tray.setContextMenu(trayMenu);
    tray.on("click", onTrayClick);
}
