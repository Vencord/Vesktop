/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Settings } from "renderer/settings";
import { isMac, isWindows } from "renderer/utils";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "platform-web",
            replacement: {
                // eslint-disable-next-line no-useless-escape
                match: /(?<=" platform-overlay"\):)\i/,
                replace: "$self.getPlatformClass()"
            }
        }
    ],

    getPlatformClass() {
        if (isMac) return "platform-osx";
        if (isWindows && Settings.store.discordWindowsTitleBar) return "platform-win";
        return "platform-web";
    }
});
