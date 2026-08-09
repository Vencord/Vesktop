/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isMac } from "renderer/utils";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            // Discord blocks specific keyboard shortcuts from being used in the web app since they collide with common browser actions.
            // We replace this list with our own instead.
            find: '"Duplicate keyboard shortcuts defined:"',
            replacement: {
                match: /\[\.\.\.\i\.\i\.binds,/,
                replace: "$self.blockedShortcuts||$&"
            }
        }
    ],

    blockedShortcuts: ["mod+shift+t", "mod+plus", "mod+minus", "mod+0"].map(s =>
        s.replace("mod", isMac ? "cmd" : "ctrl")
    )
});
