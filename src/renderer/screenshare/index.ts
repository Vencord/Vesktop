/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { openScreenPicker } from "./ScreenPicker";

navigator.mediaDevices.getDisplayMedia = async options => {
    const sources = await VencordDesktopNative.capturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: {
            width: 176,
            height: 99
        }
    });
    const id = await openScreenPicker(sources);

    return navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: "desktop"
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: id
            }
        }
    } as any);
};
