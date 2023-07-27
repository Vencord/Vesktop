/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { BrowserWindow } from "electron";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { VIEW_DIR } from "shared/paths";

export function createSplashWindow() {
    const splash = new BrowserWindow(SplashProps);

    splash.loadFile(join(VIEW_DIR, "splash.html"));

    return splash;
}
