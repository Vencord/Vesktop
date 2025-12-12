/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: '"NotificationSettingsStore',
            replacement: {
                match: /\.isPlatformEmbedded(?=\?\i\.\i\.ALL)/g,
                replace: "$&||true"
            }
        }
    ]
});
