/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: '"mod+alt+i"',
            replacement: {
                match: /"discord\.com"===location\.host/,
                replace: "false"
            }
        }
    ]
});
