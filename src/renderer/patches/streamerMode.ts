/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ".STREAMER_MODE_ENABLE,",
            replacement: {
                // remove if (platformEmbedded) check from streamer mode toggle
                match: /if\(\i\.\i\)(?=return.{0,200}?"autoToggle")/g,
                replace: ""
            }
        }
    ]
});
