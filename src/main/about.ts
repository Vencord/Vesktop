/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, BrowserWindow } from "electron";
import { readFileSync } from "fs";
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

    const html = readFileSync(join(STATIC_DIR, "about.html"), "utf-8").replaceAll("%VERSION%", app.getVersion());

    about.loadURL("data:text/html;charset=utf-8," + html);

    return about;
}
