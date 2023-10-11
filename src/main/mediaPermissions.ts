/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { session, systemPreferences } from "electron";

export function registerMediaPermissionsHandler() {
    if (process.platform !== "darwin") return;

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        if (permission === "media") {
            if (details.mediaTypes?.includes("audio")) {
                systemPreferences.askForMediaAccess("microphone").then(callback);
            }
            if (details.mediaTypes?.includes("video")) {
                systemPreferences.askForMediaAccess("camera").then(callback);
            }
        } else callback(true);
    });
}
