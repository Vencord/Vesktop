/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            // Enable the Back/Forward navigation buttons in the title bar
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /\({showBackForwardButtons:(\i)/,
                replace: "({showBackForwardButtons:($1=true)"
            }
        }
    ]
});
