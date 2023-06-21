/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { desktopCapturer, session } from "electron";

export function registerScreenShareHandler() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        const sources = await desktopCapturer.getSources({
            types: ["window", "screen"],
            thumbnailSize: {
                width: 176,
                height: 99
            }
        });

        const data = sources.map(({ id, name, thumbnail }) => ({
            id,
            name,
            url: thumbnail.toDataURL()
        }));

        const choice = await request.frame
            .executeJavaScript(`VencordDesktop.Components.ScreenShare.openScreenSharePicker(${JSON.stringify(data)})`)
            .catch(() => "cancelled");

        if (choice === "cancelled") {
            callback({});
            return;
        }

        const source = sources.find(s => s.id === choice);
        callback({
            video: source,
            audio: "loopback"
        });
    });
}
