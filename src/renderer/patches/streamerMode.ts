/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ".STREAMING_AUTO_STREAMER_MODE,",
            replacement: {
                // remove if (platformEmbedded) check from streamer mode toggle
                match: /(?<=usePredicate.{0,20}?return )\i\.\i/g,
                replace: "true"
            }
        }
    ]
});
