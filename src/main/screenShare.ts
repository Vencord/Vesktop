/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { release } from "os";

import { desktopCapturer, session, Streams } from "electron";
import type { StreamPick } from "renderer/components/ScreenSharePicker";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";

import { sendRendererCommand } from "./ipcCommands";
import { handle } from "./utils/ipcWrappers";
import { isDiscordUrl } from "./utils/isDiscordUrl";

const isWayland =
    process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

const supportsLoopbackWithoutChrome = process.platform === "win32" && Number(release().split(".").pop()) >= 19045;

// Sources shown in the currently open picker. Only serve thumbnails for these,
// otherwise the renderer could silently take screenshots of any window or screen
let pickerSourceIds = new Set<string>();

export function registerScreenShareHandler() {
    handle(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, async (_, id: string) => {
        if (!pickerSourceIds.has(id)) return;

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
        // the handler applies to the whole session, so other sites (e.g. opened via openLinksWithElectron) would get our picker
        if (!isDiscordUrl(request.frame?.top?.url)) return callback(null);

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

        if (!sources) return callback(null);

        const data = sources.map(({ id, name, thumbnail }) => ({
            id,
            name,
            url: thumbnail.toDataURL()
        }));

        if (isWayland) {
            const video = data[0];
            if (video) {
                const stream = await sendRendererCommand<StreamPick>(IpcCommands.SCREEN_SHARE_PICKER, {
                    screens: [video],
                    skipPicker: true
                }).catch(e => {
                    console.error("Error during screenshare picker", e);
                    return null;
                });

                if (stream === null) return callback(null);
            }

            callback(video ? { video: sources[0] } : null);
            return;
        }

        pickerSourceIds = new Set(data.map(s => s.id));
        const choice = await sendRendererCommand<StreamPick>(IpcCommands.SCREEN_SHARE_PICKER, {
            screens: data,
            skipPicker: false
        }).catch(e => {
            console.error("Error during screenshare picker", e);
            return null;
        });
        pickerSourceIds.clear();

        if (!choice) return callback(null);

        const source = sources.find(s => s.id === choice.id);
        if (!source) return callback(null);

        const streams: Streams = {
            video: source
        };
        if (choice.audio && process.platform === "win32") {
            // @ts-expect-error loopbackWithoutChrome is real but not documented
            streams.audio = supportsLoopbackWithoutChrome ? "loopbackWithoutChrome" : "loopback";
        }

        callback(streams);
    });
}
