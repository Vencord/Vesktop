/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "renderer/settings";

import { addPatch } from "./shared";

if (Settings.store.videoHardwareAcceleration === undefined) Settings.store.videoHardwareAcceleration = true;

addPatch({
    patches: [
        {
            find: "setHardwareEncoding(e){",
            replacement: {
                match: /setHardwareEncoding\(e\){/,
                replace: "$&Vesktop.Settings.store.videoHardwareAcceleration=e;"
            }
        }
    ]
});
