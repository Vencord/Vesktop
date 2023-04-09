/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

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
