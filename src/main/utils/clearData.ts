/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "fs/promises";

import { BrowserWindow, dialog } from "electron";
import { MessageBoxChoice, RESET_MARKER_FILE } from "main/constants";

import { relaunch } from "./relaunch";

export async function clearData(win: BrowserWindow) {
    const { response } = await dialog.showMessageBox(win, {
        message: "Are you sure you want to reset Vesktop?",
        detail: "This will log you out, clear caches and reset all your settings!\n\nVesktop will automatically restart after this operation.",
        buttons: ["Yes", "No"],
        cancelId: MessageBoxChoice.Cancel,
        defaultId: MessageBoxChoice.Default,
        type: "warning"
    });

    if (response === MessageBoxChoice.Cancel) return;

    // Chromium keeps files open while running, so the data is deleted on the next start instead
    await writeFile(RESET_MARKER_FILE, "");
    relaunch();
}
