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
                ...["close", "minimize", "maximize"].map(op => ({
                    match: new RegExp(String.raw`\i\.window\.${op}`),
                    replace: `VesktopNative.win.${op}`
                })),
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
