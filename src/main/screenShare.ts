/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { desktopCapturer, ipcMain, session, Streams } from "electron";
import type { StreamPick } from "renderer/components/ScreenSharePicker";
import { IpcEvents } from "shared/IpcEvents";

export function registerScreenShareHandler() {
    ipcMain.handle(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, async (_, id: string) => {
        const sources = await desktopCapturer.getSources({
            types: ["window", "screen"],
            thumbnailSize: {
                width: 1920,
                height: 1080
            }
        });
        return sources.find(s => s.id === id)?.thumbnail.toDataURL();
    });

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
            .executeJavaScript(`Vesktop.Components.ScreenShare.openScreenSharePicker(${JSON.stringify(data)})`)
            .then(e => e as StreamPick)
            .catch(() => null);

        if (!choice) return callback({});

        const source = sources.find(s => s.id === choice.id);
        if (!source) return callback({});

        const streams: Streams = {
            video: source
        };
        if (choice.audio && process.platform === "win32") streams.audio = "loopback";

        callback(streams);
    });
}
