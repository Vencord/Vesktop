/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";

import { isDeckGameMode, showGamePage } from "./steamOS";

export async function relaunch() {
    if (isDeckGameMode) {
        // We can't properly relaunch when running under gamescope, but we can at least navigate to our page in Steam.
        await showGamePage();
    } else if (app.isPackaged && process.env.APPIMAGE) {
        // app.relaunch() would start the binary inside the AppImage mount, which is gone once we exit
        app.relaunch({
            execPath: process.env.APPIMAGE,
            args: [...process.argv.slice(1), "--appimage-extract-and-run"] // without this, AppImage won't relaunch https://github.com/electron-userland/electron-builder/issues/4650
        });
    } else {
        app.relaunch();
    }

    app.exit();
}
