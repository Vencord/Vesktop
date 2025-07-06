/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow } from "electron";
import { join } from "path";
import { ICON_PATH, VIEW_DIR } from "shared/paths";

import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";

export async function createAboutWindow() {
    const height = 750;
    const width = height * (4 / 3);

    const about = new BrowserWindow({
        center: true,
        autoHideMenuBar: true,
        icon: ICON_PATH,
        height,
        width
    });

    makeLinksOpenExternally(about);

    const data = new URLSearchParams({
        APP_VERSION: app.getVersion()
    });

    about.loadFile(join(VIEW_DIR, "about.html"), {
        search: data.toString()
    });

    return about;
}
