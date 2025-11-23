/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "renderer/settings";
import { isMac } from "renderer/utils";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "platform-web",
            replacement: {
                match: /(?<=" platform-overlay"\):)\i/,
                replace: "$self.getPlatformClass()"
            }
        }
    ],

    getPlatformClass() {
        if (Settings.store.customTitleBar) return "platform-win";
        if (isMac) return "platform-osx";
        return "platform-web";
    }
});
