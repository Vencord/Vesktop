/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow } from "electron";

import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { loadView } from "./vesktopStatic";

export async function createAboutWindow() {
    const height = 750;
    const width = height * (4 / 3);

    const about = new BrowserWindow({
        center: true,
        autoHideMenuBar: true,
        height,
        width
    });

    makeLinksOpenExternally(about);

    const data = new URLSearchParams({
        APP_VERSION: app.getVersion()
    });

    loadView(about, "about.html", data);

    return about;
}
