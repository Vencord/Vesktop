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
                match: '"platform-web"',
                replace: "$self.getPlatformClass()"
            }
        }
    ],

    getPlatformClass() {
        if (Settings.store.nativeTitleBar) return "platform-web";
        return isMac ? "platform-osx" : "platform-win";
    }
});
