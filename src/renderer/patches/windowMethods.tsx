/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ",setSystemTrayApplications",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\i\.window\.(close|minimize|maximize)/g,
                    replace: `VesktopNative.win.$1`
                },
                {
                    // TODO: Fix eslint rule
                    // eslint-disable-next-line no-useless-escape
                    match: /(focus(\(\i\)){).{0,150}?\.focus\(\i,\i\)/,
                    replace: "$1VesktopNative.win.focus$2"
                }
            ]
        }
    ]
});
