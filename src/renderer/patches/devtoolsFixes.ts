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

        // Discord Web uses an incredibly broken devtools detector with false positives.
        // They "hide" (aka remove from storage) your token if it "detects" open devtools.
        // Due to the false positives, this leads to random logouts.
        // Patch their devtools detection to use proper Electron APIs instead to fix the false positives
        {
            find: ".setDevtoolsCallbacks(",
            group: true,
            replacement: [
                {
                    match: /if\(null!=(\i)\)(?=.{0,50}\1\.window\.setDevtoolsCallbacks)/,
                    replace: "if(true)"
                },
                {
                    match: /\b\i\.window\.setDevtoolsCallbacks/g,
                    replace: "VesktopNative.win.setDevtoolsCallbacks"
                }
            ]
        }
    ]
});
