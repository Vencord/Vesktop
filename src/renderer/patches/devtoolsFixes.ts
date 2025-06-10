/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        // Discord Web blocks the devtools keybin on mac specifically, disable that
        {
            find: '"mod+alt+i"',
            replacement: {
                match: /"discord\.com"===location\.host/,
                replace: "false"
            }
        },
        {
            find: ".setDevtoolsCallbacks(",
            group: true,
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /if\(null!=(\i)\)(?=.{0,50}\1\.window\.setDevtoolsCallbacks)/,
                    replace: "if(true)"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\b\i\.window\b/g,
                    replace: "VesktopNative.win"
                }
            ]
        }
    ]
});
