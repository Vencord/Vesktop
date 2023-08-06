/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ".wordmarkWindows",
            replacement: [
                {
                    match: /case \i\.\i\.WINDOWS:/,
                    replace: 'case "WEB":'
                },
                ...["close", "minimize", "fullscreen", "maximize"].map(op => ({
                    match: new RegExp(String.raw`\i\.default\.${op}\b`),
                    replace: `VesktopNative.win.${op}`
                }))
            ]
        }
    ]
});
