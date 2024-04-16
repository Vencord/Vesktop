/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { keybindCallbacks } from "renderer";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ".default.Messages.KEYBINDS,children:",
            replacement: {
                match: /.\.isPlatformEmbedded/,
                replace: "true"
            }
        },
        {
            find: "[kb store] KeybindStore",
            replacement: [
                {
                    match: /(inputEventRegister\(parseInt\((.{1,2})\),(.{1,2}),(.{1,2}),(.{1,2})\);else\{)([^;]*;[^;]*;.{1,2}\.keyup&&.{1,2}\.bindGlobal\(\(0,(.{1,2}\.toString)\))/,
                    replace: "$1$self.registerKeybind($2,$3,$4,$7);return;$6"
                },
                {
                    // WHY IS THE RADIX SPEICIFIED
                    match: /(inputEventUnregister\(parseInt\((.{1,2}),10\)\);else if\(\i\[\i\]\)\{)/,
                    replace: "$1$self.unregisterKeybind($2);return;"
                }
            ]
        }
    ],

    registerKeybind(
        id: string,
        shortcut: number[][],
        callback: () => void,
        toString: (shortcut: number[][]) => string
    ) {
        keybindCallbacks[id] = callback;
        VesktopNative.keybind.register(id, toString(shortcut));
    },
    unregisterKeybind(id: string) {
        delete keybindCallbacks[id];
        VesktopNative.keybind.unregister(id);
    }
});
