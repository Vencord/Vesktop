/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "renderer/settings";

import { addPatch } from "./shared";

// Popout windows are frameless when not using the native title bar, so make Discord render its own title bar in them
if (!Settings.store.nativeTitleBar)
    addPatch({
        patches: [
            {
                find: '"Missing guestWindow reference"',
                replacement: {
                    match: /(\{withTitleBar:(\i),isFullScreen:\i\}=\i;return \2&&)\i\.isPlatformEmbedded/,
                    replace: "$1true"
                }
            }
        ]
    });
