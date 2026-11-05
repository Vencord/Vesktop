/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { session, systemPreferences } from "electron";

import { isDiscordUrl } from "./utils/isDiscordUrl";

// Electron grants every permission by default. Only allow them for Discord, not for other sites
// (e.g. opened via openLinksWithElectron) or our own views
export function registerMediaPermissionsHandler() {
    // webContents is null for some checks (e.g. notifications and cross-origin subframes), so go by origin
    session.defaultSession.setPermissionCheckHandler((_webContents, _permission, requestingOrigin, details) =>
        isDiscordUrl(details.embeddingOrigin ?? requestingOrigin)
    );

    session.defaultSession.setPermissionRequestHandler(async (webContents, _permission, callback, details) => {
        // check the top level url so that frames embedded by Discord (e.g. YouTube) keep working
        if (!isDiscordUrl(webContents.getURL())) return callback(false);

        let granted = true;

        if (process.platform === "darwin" && "mediaTypes" in details) {
            if (details.mediaTypes?.includes("audio")) {
                granted &&= await systemPreferences.askForMediaAccess("microphone");
            }
            if (details.mediaTypes?.includes("video")) {
                granted &&= await systemPreferences.askForMediaAccess("camera");
            }
        }

        callback(granted);
    });
}
