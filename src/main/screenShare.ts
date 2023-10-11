/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { desktopCapturer, session, Streams } from "electron";
import type { StreamPick } from "renderer/components/ScreenSharePicker";
import { IpcEvents } from "shared/IpcEvents";

import { handle } from "./utils/ipcWrappers";

const isWayland =
    process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

export function registerScreenShareHandler() {
    handle(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, async (_, id: string) => {
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
        // request full resolution on wayland right away because we always only end up with one result anyway
        const width = isWayland ? 1920 : 176;
        const sources = await desktopCapturer
            .getSources({
                types: ["window", "screen"],
                thumbnailSize: {
                    width,
                    height: width * (9 / 16)
                }
            })
            .catch(err => console.error("Error during screenshare picker", err));

        if (!sources) return callback({});

        const data = sources.map(({ id, name, thumbnail }) => ({
            id,
            name,
            url: thumbnail.toDataURL()
        }));

        if (isWayland) {
            const video = data[0];
            if (video) {
                const stream = await request.frame
                    .executeJavaScript(
                        `Vesktop.Components.ScreenShare.openScreenSharePicker(${JSON.stringify([video])},true)`
                    )
                    .catch(() => null);
                if (stream === null) return callback({});
            }

            callback(video ? { video: sources[0] } : {});
            return;
        }

        const choice = await request.frame
            .executeJavaScript(`Vesktop.Components.ScreenShare.openScreenSharePicker(${JSON.stringify(data)})`)
            .then(e => e as StreamPick)
            .catch(e => {
                console.error("Error during screenshare picker", e);
                return null;
            });

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
