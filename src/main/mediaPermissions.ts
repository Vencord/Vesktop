/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { session, systemPreferences } from "electron";

export function registerMicrophonePermissionsHandler() {
    if (process.platform !== "darwin") return;

    session.defaultSession.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
        let granted = true;

        if ("mediaTypes" in details) {
            if (details.mediaTypes?.includes("audio")) {
                if (systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
                    await systemPreferences.askForMediaAccess("microphone").then(e => granted = e);
                }
            }
        }

        callback(granted);
    });
}

export function registerVideoPermissionsHandler() {
    if (process.platform !== "darwin") return;

    session.defaultSession.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
        let granted = true;

        if ("mediaTypes" in details) {
            if (details.mediaTypes?.includes("video")) {
                if (systemPreferences.getMediaAccessStatus("camera") !== "granted") {
                    await systemPreferences.askForMediaAccess("camera").then(e => granted = e);
                }
            }
        }

        callback(granted);
    });
}
