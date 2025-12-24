/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow } from "electron";

import { loadView } from "./vesktopStatic";

export function createRecoveryModeWindow() {
    const width = 650;
    const height = width * (9 / 16);

    const win = new BrowserWindow({
        center: true,
        autoHideMenuBar: true,
        height,
        width,
        resizable: false,
        webPreferences: {
            nodeIntegration: true
        }
    });

    loadView(win, "recovery.html");
}
